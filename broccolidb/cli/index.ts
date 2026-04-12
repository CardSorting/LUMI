#!/usr/bin/env node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import chalk from 'chalk';
import ora from 'ora';
import { simpleGit } from 'simple-git';
import { AgentContext } from '../core/agent-context.js';
import { Connection } from '../core/connection.js';
import { AiService } from '../core/embedding.js';
import { BroccoliDBMCP } from '../core/mcp.js';
import type { Repository } from '../core/repository.js';
import { Workspace } from '../core/workspace.js';

const args = process.argv.slice(2);
const command = args[0];

const BROCCOLI_ICON = chalk.green('🥦');
const ASCII_LOGO = `
${chalk.green.bold('  ____                             _ _ ____  ____  ')}
${chalk.green.bold(' | __ ) _ __ ___   ___ ___ ___ | (_)  _ \\| __ ) ')}
${chalk.green(" |  _ \\| '__/ _ \\ / __/ __/ _ \\| | | | | |  _ \\ ")}
${chalk.green(' | |_) | | | (_) | (_| (_| (_) | | | |_| | |_) |')}
${chalk.green.bold(' |____/|_|  \\___/ \\___\\___\\___/|_|_|____/|____/ ')}
`;

async function main() {
  console.info(ASCII_LOGO);
  console.info(
    `${BROCCOLI_ICON} ${chalk.bold.green('BroccoliDB')} — ${chalk.dim('The Context Engine for Agents')}\n`
  );

  if (command === 'init') {
    await init();
  } else if (command === 'serve') {
    await serve();
  } else if (command === 'config') {
    await config();
  } else if (command === 'status') {
    await status();
  } else if (command === '--help' || !command) {
    showHelp();
  } else {
    console.warn(chalk.red(`Unknown command: ${command}`));
    showHelp();
    process.exit(1);
  }
}

function showHelp() {
  console.info(`${chalk.bold.white('USAGE')}`);
  console.info(`  ${chalk.dim('$')} npx broccolidb ${chalk.yellow('<command>')}\n`);

  console.info(`${chalk.bold.white('COMMANDS')}`);
  console.info(
    `  ${chalk.green('init')}    ${chalk.dim('→')}  Initialize and index the current Git repository`
  );
  console.info(
    `  ${chalk.green('status')}  ${chalk.dim('→')}  View the health and stats of your Context Graph`
  );
  console.info(`  ${chalk.green('serve')}   ${chalk.dim('→')}  Start the BroccoliDB MCP server`);
  console.info(`  ${chalk.green('config')}  ${chalk.dim('→')}  Manage local settings and secrets\n`);

  console.info(`${chalk.bold.white('EXAMPLES')}`);
  console.info(`  ${chalk.dim('$')} npx broccolidb init`);
  console.info(`  ${chalk.dim('$')} npx broccolidb status`);
  console.info(`  ${chalk.dim('$')} npx broccolidb config set gemini_api_key xxxx\n`);
}

async function status() {
  const dbPath = path.resolve(process.cwd(), 'broccolidb.db');
  if (!fs.existsSync(dbPath)) {
    console.warn(
      chalk.red(`✘ Error: Database not found. Run ${chalk.bold('npx broccolidb init')} first.`)
    );
    return;
  }

  const spinner = ora('Analyzing Context Graph...').start();
  const conn = new Connection({ dbPath });
  const pool = conn.getPool();

  try {
    const userId = 'local-user';
    const workspaceId = 'local-workspace';
    const ws = new Workspace(pool, userId, workspaceId);
    await ws.init();

    const repoName = path.basename(process.cwd());
    const _repo = await ws.getRepo(repoName);

    // Stats
    const nodes = await pool.selectWhere('knowledge', []);
    const edgesCount = nodes.reduce((acc, n) => acc + JSON.parse(n.edges || '[]').length, 0);
    const hubNodes = nodes.filter((n) => (n.hubScore || 0) > 5).length;
    const totalSize = (fs.statSync(dbPath).size / (1024 * 1024)).toFixed(2);

    // Embedding Health
    let apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      const row = await pool.selectOne('settings', [{ column: 'key', value: 'gemini_api_key' }]);
      apiKey = row?.value;
    }
    const embeddingStatus = apiKey
      ? chalk.green('Optimal (Gemini)')
      : chalk.yellow('Basic (Keyword Fallback)');

    spinner.stop();

    console.info(`${chalk.bold.white('REPOSITORY STATUS')}`);
    console.info(`  ${chalk.bold('Path:')}           ${chalk.dim(process.cwd())}`);
    console.info(
      `  ${chalk.bold('Database:')}       ${chalk.cyan('broccolidb.db')} ${chalk.dim(`(${totalSize}MB)`)}`
    );
    console.info(`  ${chalk.bold('Embeddings:')}     ${embeddingStatus}`);
    if (!apiKey) {
      console.info(
        `  ${chalk.dim('TIP: Use `npx broccolidb config wizard` to enable semantic search.')}`
      );
    }
    console.info();

    console.info(`${chalk.bold.white('GRAPH DENSITY')}`);
    console.info(`  ${chalk.bold('Nodes:')}          ${chalk.green(nodes.length)}`);
    console.info(`  ${chalk.bold('Edges:')}          ${chalk.green(edgesCount)}`);
    console.info(
      `  ${chalk.bold('Hub Count:')}      ${chalk.green(hubNodes)} ${chalk.dim('(Highly connected files)')}`
    );
    console.info();

    if (nodes.length > 0) {
      console.info(`${chalk.bold.white('TOP HUB NODES')}`);
      const topHubs = [...nodes].sort((a, b) => (b.hubScore || 0) - (a.hubScore || 0)).slice(0, 5);
      topHubs.forEach((h) => {
        console.info(
          `  ${chalk.dim('•')} ${chalk.bold(h.id.padEnd(20))} ${chalk.dim('score:')} ${chalk.yellow(h.hubScore)}`
        );
      });
    }
    console.info();
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    spinner.fail(chalk.red(`Analysis failed: ${error}`));
  }
}

async function config() {
  const subCommand = args[1];
  const key = args[2];
  const value = args[3];

  const dbPath = path.resolve(process.cwd(), 'broccolidb.db');
  const conn = new Connection({ dbPath });
  const pool = conn.getPool();

  if (subCommand === 'set' && key && value !== undefined) {
    await pool.push({
      type: 'upsert',
      table: 'settings',
      where: [{ column: 'key', value: key }],
      values: { key, value, updatedAt: Date.now() },
      layer: 'infrastructure',
    });
    console.info(
      `${chalk.green('✅')} ${chalk.bold('Saved')} ${chalk.cyan(key)} ${chalk.dim('→')} ${key.includes('key') ? chalk.dim('********') : chalk.white(value)}`
    );
  } else if (subCommand === 'get' && key) {
    const row = await pool.selectOne('settings', [{ column: 'key', value: key }]);
    if (row) {
      console.info(chalk.cyan(row.value));
    } else {
      console.warn(chalk.red(`✘ Error: Setting '${key}' not found.`));
    }
  } else if (subCommand === 'list') {
    const rows = await pool.selectWhere('settings', []);
    console.info(chalk.bold.white('CONFIGURATION'));
    if (rows.length === 0) {
      console.info(chalk.dim('  (No settings found)'));
    } else {
      rows.forEach((r) => {
        const displayValue = r.key.includes('key') ? chalk.dim('********') : chalk.cyan(r.value);
        console.info(`  ${chalk.bold(r.key.padEnd(18))} ${chalk.dim('│')} ${displayValue}`);
      });
    }
    console.info();
  } else if (subCommand === 'wizard') {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.info(chalk.bold.white('SETTINGS WIZARD'));
    const key = await rl.question(`${chalk.green('?')} ${chalk.bold('Enter Gemini API Key:')} `);
    if (key) {
      await pool.push({
        type: 'upsert',
        table: 'settings',
        where: [{ column: 'key', value: 'gemini_api_key' }],
        values: { key: 'gemini_api_key', value: key, updatedAt: Date.now() },
        layer: 'infrastructure',
      });
      console.info(`${chalk.green('✅')} API key updated.`);
    }
    rl.close();
  } else {
    console.warn(`${chalk.bold.red('✘ Error:')} Invalid arguments.`);
    console.info(`${chalk.bold('Usage:')} broccolidb config <set|get|list|wizard> [key] [value]`);
  }
}

async function init() {
  console.info(`${chalk.bold.white('SETUP WIZARD')}`);
  const spinner = ora({ text: 'Checking environment...', color: 'green' }).start();

  // Auto-update .gitignore
  const gitignorePath = path.resolve(process.cwd(), '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.includes('broccolidb.db')) {
      fs.appendFileSync(
        gitignorePath,
        '\n# BroccoliDB\nbroccolidb.db\nbroccolidb.db-wal\nbroccolidb.db-shm\n'
      );
      spinner.info(
        `Automatically added ${chalk.cyan('broccolidb.db')} to ${chalk.bold('.gitignore')}`
      );
    }
  } else {
    fs.writeFileSync(
      gitignorePath,
      '# BroccoliDB\nbroccolidb.db\nbroccolidb.db-wal\nbroccolidb.db-shm\n'
    );
    spinner.info(`Created ${chalk.bold('.gitignore')} with ${chalk.cyan('broccolidb.db')}`);
  }

  const dbPath = path.resolve(process.cwd(), 'broccolidb.db');
  const conn = new Connection({ dbPath });
  const pool = conn.getPool();

  // Check for API key
  let apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    const row = await pool.selectOne('settings', [{ column: 'key', value: 'gemini_api_key' }]);
    apiKey = row?.value;
  }

  spinner.stop();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  if (!apiKey) {
    console.info(`\n${chalk.yellow('⚠️ ')} ${chalk.bold('Gemini API Key missing!')}`);
    console.info(`${chalk.dim('BroccoliDB uses Gemini for high-performance semantic search.')}\n`);

    apiKey = await rl.question(`${chalk.green('?')} ${chalk.bold('Enter your Gemini API Key:')} `);

    if (apiKey) {
      await pool.push({
        type: 'upsert',
        table: 'settings',
        where: [{ column: 'key', value: 'gemini_api_key' }],
        values: { key: 'gemini_api_key', value: apiKey, updatedAt: Date.now() },
        layer: 'infrastructure',
      });
      console.info(`\n${chalk.green('✅')} ${chalk.dim('Key persisted to local database.')}\n`);
    } else {
      console.warn(
        `\n${chalk.red('✘')} ${chalk.bold('Setup aborted.')} AI features will be disabled.`
      );
      process.exit(1);
    }
  }

  spinner.start('Initializing database...');
  const userId = 'local-user';
  const workspaceId = 'local-workspace';
  const repoName = path.basename(process.cwd());

  const ws = new Workspace(pool, userId, workspaceId);
  await ws.init();

  let repo!: Repository;
  try {
    repo = await ws.getRepo(repoName);
    } catch {
      // Ignore
    }
  spinner.succeed(`Database ready ${chalk.dim(`(${dbPath})`)}`);

  // Seamless Integration
  const claudeConfigPath = getClaudeConfigPath();
  if (claudeConfigPath) {
    console.info(`\n${chalk.bold.white('SEAMLESS INTEGRATION')}`);
    const answer = await rl.question(
      `${chalk.green('?')} ${chalk.bold('Automatically add BroccoliDB to Claude Desktop?') + chalk.dim(' (Y/n)')} `
    );

    if (answer.toLowerCase() !== 'n') {
      try {
        const config = fs.existsSync(claudeConfigPath)
          ? JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'))
          : { mcpServers: {} };

        config.mcpServers = config.mcpServers || {};
        config.mcpServers.broccolidb = {
          command: 'npx',
          args: ['-y', 'broccolidb', 'serve'],
          cwd: process.cwd(),
          env: {
            GEMINI_API_KEY: apiKey,
          },
        };

        fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
        console.info(
          `${chalk.green('✅')} ${chalk.bold('Integrated!')} BroccoliDB added to ${chalk.dim(claudeConfigPath)}\n`
        );
      } catch (e: unknown) {
        const error = e instanceof Error ? e.message : String(e);
        console.warn(`${chalk.red('✘')} ${chalk.bold('Integration failed:')} ${error}\n`);
      }
    }
  }

  spinner.start('Scanning Git repository...');
  const git = simpleGit();
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    spinner.fail(chalk.red('Fatal: Not a Git repository.'));
    process.exit(1);
  }

  const filesStr = await git.raw(['ls-files']);
  const files = filesStr.split('\n').filter((f: string) => f.trim().length > 0);
  spinner.succeed(`Discovered ${chalk.bold.green(files.length)} files for indexing.`);

  const head = await git.revparse(['--abbrev-ref', 'HEAD']);
  const branch = head.trim();

  try {
    await repo.resolveRef(branch);
  } catch {
    spinner.info(`New branch detected: ${chalk.cyan(branch)}`);
  }

  let count = 0;
  const indexSpinner = ora({
    text: `Indexing files (0/${files.length})...`,
    color: 'cyan',
  }).start();

  for (const file of files) {
    const fullPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isFile()) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      await repo.files().writeFile(branch, file, content, 'BroccoliDB-Init', {
        message: `Initial indexing of ${file}`,
      });
      count++;
      if (count % 5 === 0 || count === files.length) {
        const progress = Math.round((count / files.length) * 100);
        indexSpinner.text = `Indexing ${chalk.bold(count)}/${files.length} ${chalk.dim(`(${progress}%)`)}...`;
      }
    }
  }
  indexSpinner.succeed(`Indexing complete! ${chalk.bold.green(count)} nodes in graph.`);

  rl.close();

  console.info(
    `\n${chalk.bold.green('✨ SUCCESS')} ${chalk.white('BroccoliDB is ready for use.')}\n`
  );

  console.info(`${chalk.bold.white('MANUAL CONFIGURATION')}`);
  console.info(chalk.dim('If you prefer manual setup, add this to your config:'));

  const configBlock = JSON.stringify(
    {
      mcpServers: {
        broccolidb: {
          command: 'npx',
          args: ['-y', 'broccolidb', 'serve'],
          cwd: process.cwd(),
        },
      },
    },
    null,
    2
  );

  console.info(chalk.bgGray.black(`\n${configBlock}\n`));

  console.info(`${chalk.bold.white('NEXT STEPS')}`);
  console.info(`  1. ${chalk.bold('Restart')} Claude Desktop`);
  console.info(`  2. In a new chat, ask: ${chalk.cyan('"What are the most important files?"')}`);
  console.info(`  3. Run ${chalk.bold('npx broccolidb status')} anytime to see graph health.\n`);
}

function getClaudeConfigPath(): string | null {
  const home = os.homedir();
  let configPath = '';

  if (process.platform === 'darwin') {
    configPath = path.join(
      home,
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json'
    );
  } else if (process.platform === 'win32') {
    configPath = path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
  }

  return configPath && fs.existsSync(path.dirname(configPath)) ? configPath : null;
}

async function serve() {
  const dbPath = path.resolve(process.cwd(), 'broccolidb.db');
  if (!fs.existsSync(dbPath)) {
    console.error(
      chalk.red(`✘ Error: Database not found. Run ${chalk.bold('npx broccolidb init')} first.`)
    );
    process.exit(1);
  }

  const conn = new Connection({ dbPath });
  const pool = conn.getPool();

  // Load API Key from settings if available
  const keyRow = await pool.selectOne('settings', [{ column: 'key', value: 'gemini_api_key' }]);
  if (keyRow) {
    process.env.GEMINI_API_KEY = keyRow.value;
  }

  const userId = 'local-user';
  const workspaceId = 'local-workspace';
  const repoName = path.basename(process.cwd());

  const ws = new Workspace(pool, userId, workspaceId);
  await ws.init();
  const repo = await ws.getRepo(repoName);

  // Initialize AiService if key is present
  let _aiService: AiService | undefined;
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    _aiService = new AiService();
  }

  const agentContext = new AgentContext(ws, pool, userId, { agentId: 'cli', name: 'CLI' });

  const server = new BroccoliDBMCP(repo, agentContext);
  const transport = new StdioServerTransport();

  // Logs to stderr
  console.error(chalk.dim(`[BroccoliDB] Internal server starting for ${chalk.bold(repoName)}...`));
  // @ts-expect-error - Internal server access is required for CLI initialization
  await server.server.connect(transport);
}

main().catch((err) => {
  console.error(chalk.red('\nFatal error:'), err);
  process.exit(1);
});
