import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { GraphEdge, KnowledgeBaseItem } from './agent-context/types.js';
import type { AgentContext, TraversalFilter } from './agent-context.js';
import { executor } from './executor.js';
import type { Repository } from './repository.js';
import { EnvironmentTracker, telemetryQueue } from './tracker.js';

export class BroccoliDBMCP {
  private server: McpServer;
  private repo: Repository;
  private agentContext?: AgentContext | undefined;

  constructor(repo: Repository, agentContext?: AgentContext) {
    this.repo = repo;
    this.agentContext = agentContext;
    this.server = new McpServer({
      name: 'BroccoliDB',
      version: '1.0.0',
    });
    this.registerTools();
    this.startBackgroundCleanup();
  }

  private startBackgroundCleanup() {
    // Run cleanup every 15 minutes
    setInterval(
      () => {
        this.cleanupExpiredBranches().catch((err) =>
          console.error(`[AgentGit][Lifecycle] Cleanup failed: ${err}`)
        );
      },
      15 * 60 * 1000
    );
    // Also run once on startup
    this.cleanupExpiredBranches().catch(() => {});
  }

  private async cleanupExpiredBranches() {
    const db = this.repo.getDb();
    const now = Date.now();
    const expired = await db.selectWhere('branches', [
      { column: 'expiresAt', value: now, operator: '<' },
    ]);

    for (const branch of expired) {
      console.log(`[AgentGit][Lifecycle] Self-destructing expired ghost branch: ${branch.name}`);
      try {
        await this.repo.deleteBranch(branch.name);
    } catch {
      // Ignore
    }
    }
  }

  private async executeTool<T>(
    name: string,
    op: () => Promise<T>
  ): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
    try {
      const result = await executor.execute(`mcp:${name}`, op);
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return { content: [{ type: 'text', text }] };
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      let advice = '';
      if (err.code === 'MERGE_CONFLICT')
        advice = '\nTIP: Use `broccolidb_list_files` to inspect conflicts and resolve manually.';
      if (err.code === 'FILE_LOCKED')
        advice = '\nTIP: Wait for the lock to expire or ask the owning agent to release it.';
      if (err.code === 'BUDGET_EXCEEDED')
        advice = '\nTIP: This task is too expensive. Consider breaking it into smaller sub-tasks.';

      const message = err.message || String(e);
      return {
        content: [{ type: 'text', text: `[BroccoliDB][${name}] Error: ${message}${advice}` }],
        isError: true,
      };
    }
  }

  private registerTools() {
    this.server.tool(
      'broccolidb_list_files',
      'List all files on a given AgentGit branch',
      {
        branch: z.string().describe('Branch name to list files from'),
        prefix: z.string().optional().describe('Optional path prefix to filter files'),
      },
      async (args) => {
        return this.executeTool('list_files', async () => {
          const files = await this.repo.files().listFiles(args.branch, args.prefix);
          return (
            files.map((f) => `${f.path} (${(f.size / 1024).toFixed(1)}kb)`).join('\n') ||
            'No files found.'
          );
        });
      }
    );

    this.server.tool(
      'broccolidb_read_file',
      'Read a file from an AgentGit branch',
      {
        branch: z.string().describe('Branch name'),
        path: z.string().describe('Path to the file'),
      },
      async (args) => {
        return this.executeTool('read_file', async () => {
          const file = await this.repo.files().readFile(args.branch, args.path);
          return file.content;
        });
      }
    );

    this.server.tool(
      'broccolidb_write_file',
      'Write a file directly to an AgentGit branch, creating a commit automatically.',
      {
        branch: z.string().describe('Branch name'),
        path: z.string().describe('Path to write'),
        content: z.string().describe('File content'),
        message: z.string().describe('Commit message'),
        decisionIds: z
          .string()
          .optional()
          .describe('Comma-separated Knowledge Base Decision IDs to link to this commit'),
      },
      async (args) => {
        return this.executeTool('write_file', async () => {
          const decisionIds = args.decisionIds
            ? args.decisionIds.split(',').map((id) => id.trim())
            : undefined;
          const commitId = await this.repo
            .files()
            .writeFile(args.branch, args.path, args.content, 'AgentGitMCP', {
              message: args.message,
              decisionIds,
            });
          return `Successfully wrote file and created commit ${commitId}`;
        });
      }
    );

    this.server.tool(
      'broccolidb_delete_file',
      'Delete a file from an AgentGit branch',
      {
        branch: z.string().describe('Branch name'),
        path: z.string().describe('Path to the file to delete'),
      },
      async (args) => {
        return this.executeTool('delete_file', async () => {
          const commitId = await this.repo
            .files()
            .deleteFile(args.branch, args.path, 'AgentGitMCP');
          return `Successfully deleted file and created commit ${commitId}`;
        });
      }
    );

    this.server.tool(
      'broccolidb_checkout',
      'Gets current branch log',
      {
        branch: z.string().describe('Branch name'),
      },
      async (args) => {
        return this.executeTool('checkout', async () => {
          const logs = await this.repo.log(args.branch, { limit: 1 });
          if (logs.length === 0) return `Branch empty or not found.`;
          const latest = logs[0];
          if (!latest) return `Branch empty or not found.`;
          return `Currently at commit ${latest.id} by ${latest.author || 'System'}\nMessage: ${latest.message || 'No message'}`;
        });
      }
    );

    this.server.tool(
      'broccolidb_diff',
      'Compare two refs (branch, tag, or commit ID)',
      {
        refA: z.string().describe('First ref to compare'),
        refB: z.string().describe('Second ref to compare'),
      },
      async (args) => {
        return this.executeTool('diff', async () => {
          return await this.repo.diff(args.refA, args.refB);
        });
      }
    );

    this.server.tool(
      'broccolidb_history',
      'List commit history for a branch with semantic filtering',
      {
        branch: z.string().describe('Branch name'),
        limit: z.number().optional().default(10).describe('Max number of commits to return'),
        author: z.string().optional().describe('Filter by author name'),
        messageRegex: z.string().optional().describe('Filter by commit message regex'),
      },
      async (args) => {
        return this.executeTool('history', async () => {
          const options: { limit: number; author?: string; messageRegex?: string } = {
            limit: args.limit,
          };
          if (args.author) options.author = args.author;
          if (args.messageRegex) options.messageRegex = args.messageRegex;

          const history = await this.repo.log(args.branch, options);
          return (
            history
              .map(
                (h) =>
                  `[${h.id.substring(0, 7)}] ${h.author}: ${h.message} (${new Date(
                    h.timestamp
                  ).toISOString()})`
              )
              .join('\n') || 'No history found matching criteria.'
          );
        });
      }
    );

    this.server.tool(
      'broccolidb_status',
      'Get repository and branch overview',
      {
        branch: z.string().describe('Branch name'),
      },
      async (args) => {
        return this.executeTool('status', async () => {
          return await this.repo.status(args.branch);
        });
      }
    );

    this.server.tool(
      'broccolidb_rebase',
      'Rebase a branch onto another ref',
      {
        branch: z.string().describe('Branch to rebase'),
        onto: z.string().describe('Ref to rebase onto'),
        author: z.string().describe('Author name for replayed commits'),
      },
      async (args) => {
        return this.executeTool('rebase', async () => {
          return await this.repo.rebase(args.branch, args.onto, args.author);
        });
      }
    );

    this.server.tool(
      'broccolidb_stash',
      'Stash current branch state without committing',
      {
        branch: z.string().describe('Branch to stash'),
        label: z.string().optional().describe('Optional label for the stash'),
      },
      async (args) => {
        return this.executeTool('stash', async () => {
          const stashId = await this.repo.stash(args.branch, args.label);
          return `Successfully stashed state. Stash ID: ${stashId}`;
        });
      }
    );

    this.server.tool(
      'broccolidb_bisect',
      'Find a bad commit using binary search',
      {
        badRef: z.string().describe('Known bad ref'),
        goodRef: z.string().describe('Known good ref'),
        targetFile: z.string().describe('File path to check for changes'),
      },
      async (args) => {
        return this.executeTool('bisect', async () => {
          const result = await this.repo.bisect(args.badRef, args.goodRef, async (node) => {
            const tree = node.tree || node.data?.tree || {};
            return !!tree[args.targetFile];
          });
          return `Bisect complete. First "bad" node found: ${result.id} (${result.message})`;
        });
      }
    );

    this.server.tool(
      'broccolidb_merge',
      'Merge one branch into another',
      {
        source: z.string().describe('Source branch name'),
        target: z.string().describe('Target branch name'),
        author: z.string().describe('Author name for the merge commit'),
      },
      async (args) => {
        return this.executeTool('merge', async () => {
          const resultId = await this.repo.merge(args.source, args.target, args.author);
          return resultId ? `Successfully merged. New commit: ${resultId}` : 'Already up to date.';
        });
      }
    );

    this.server.tool(
      'broccolidb_branch_hypothesis',
      'Branch the current reasoning state into a new hypothesis for parallel exploration.',
      {
        baseRef: z.string().describe('Branch or node to fork from'),
        hypothesisName: z.string().describe('Name for the new hypothesis branch'),
      },
      async (args) => {
        return this.executeTool('branch_hypothesis', async () => {
          await this.repo.branchHypothesis(args.baseRef, args.hypothesisName);
          return `Created hypothesis branch '${args.hypothesisName}' from '${args.baseRef}'`;
        });
      }
    );

    this.server.tool(
      'broccolidb_merge_conclusion',
      'Merge a hypothesis explorer branch and mark the result as a definitive conclusion.',
      {
        source: z.string().describe('Hypothesis branch to merge'),
        target: z.string().describe('Target branch (e.g. main)'),
        author: z.string().describe('Author name'),
        message: z.string().optional().describe('Summary of the conclusion'),
      },
      async (args) => {
        return this.executeTool('merge_conclusion', async () => {
          const resId = await this.repo.mergeConclusion(
            args.source,
            args.target,
            args.author,
            args.message
          );
          return resId
            ? `Successfully merged conclusion. New node: ${resId}`
            : 'Already up to date.';
        });
      }
    );

    this.server.tool(
      'broccolidb_diff_reasoning',
      'Analyze the logical differences between two branches, highlighting new hypotheses and conclusions.',
      {
        refA: z.string().describe('Baseline reference'),
        refB: z.string().describe('Comparison reference'),
      },
      async (args) => {
        return this.executeTool('diff_reasoning', async () => {
          const diff = await this.repo.getReasoningDiff(args.refA, args.refB);
          let report = `Reasoning Diff between ${args.refA} and ${args.refB}\n`;
          report += `Common Ancestor: ${diff.commonAncestor || 'None'}\n\n`;

          report += `[+] Added Hypotheses/Conclusions:\n`;
          report +=
            diff.added
              .map((n) => ` - [${n.id.substring(0, 7)}] (${n.type}) ${n.author}: ${n.message}`)
              .join('\n') || ' None\n';

          report += `\n[-] Removed Hypotheses/Conclusions:\n`;
          report +=
            diff.removed
              .map((n) => ` - [${n.id.substring(0, 7)}] (${n.type}) ${n.author}: ${n.message}`)
              .join('\n') || ' None\n';

          return report;
        });
      }
    );

    this.server.tool(
      'broccolidb_audit_reasoning',
      'Scan the knowledge graph for logical contradictions and conflicting facts.',
      {
        startId: z.string().describe('Node ID to start the audit from'),
        depth: z.number().optional().default(3).describe('Traversal depth for the audit'),
      },
      async (args) => {
        return this.executeTool('audit_reasoning', async () => {
          if (!this.agentContext) return 'AgentContext not available for auditing.';
          const reports = await this.agentContext.detectContradictions(args.startId, args.depth);
          if (reports.length === 0) return 'No logical contradictions detected.';

          let output = `[Audit Report] Found ${reports.length} potential contradictions:\n`;
          for (const r of reports) {
            output += ` - Conflict between ${r.nodeId} and ${r.conflictingNodeId} (Score: ${r.confidence.toFixed(2)})\n`;
          }
          return output;
        });
      }
    );

    this.server.tool(
      'broccolidb_get_lineage',
      'Trace the logical pedigree and evidence path of a specific conclusion or fact.',
      {
        nodeId: z.string().describe('Node ID to trace'),
      },
      async (args) => {
        return this.executeTool('get_lineage', async () => {
          if (!this.agentContext) return 'AgentContext not available for lineage tracing.';
          const pedigree = await this.agentContext.getReasoningPedigree(args.nodeId);
          let output = `[Lineage Trace] ${args.nodeId}\n`;
          output += `Evidence Path:\n`;
          for (const step of pedigree.lineage) {
            output += ` - [${step.nodeId.substring(0, 7)}] (${step.type}): ${step.content.substring(0, 50)}...\n`;
          }
          return output;
        });
      }
    );

    this.server.tool(
      'broccolidb_visualize_pedigree',
      'Generate a Mermaid diagram representing the logical pedigree of a conclusion.',
      {
        nodeId: z.string().describe('Node ID to visualize'),
      },
      async (args) => {
        return this.executeTool('visualize_pedigree', async () => {
          if (!this.agentContext) return 'AgentContext not available.';
          const pedigree = await this.agentContext.getReasoningPedigree(args.nodeId);

          let mermaid = 'graph TD\n';
          for (const step of pedigree.lineage) {
            const shortId = step.nodeId.substring(0, 7);
            const content = `${step.content.substring(0, 30).replace(/"/g, "'")}...`;
            mermaid += `  ${shortId}["${shortId} (${step.type})<br/>${content}"]\n`;
          }

          // Add edges
          for (const step of pedigree.lineage) {
            const node = await this.agentContext.getKnowledge(step.nodeId);
            for (const edge of node.edges) {
              if (edge.type === 'supports' || edge.type === 'depends_on') {
                mermaid += `  ${step.nodeId.substring(0, 7)} -- ${edge.type} --> ${edge.targetId.substring(0, 7)}\n`;
              }
            }
          }

          return `\`\`\`mermaid\n${mermaid}\n\`\`\``;
        });
      }
    );

    this.server.tool(
      'broccolidb_cherry_pick',
      'Apply a specific commit to a target branch',
      {
        nodeId: z.string().describe('Commit ID to copy'),
        target: z.string().describe('Target branch name'),
        author: z.string().describe('Author name for the new commit'),
      },
      async (args) => {
        return this.executeTool('cherry_pick', async () => {
          const resultId = await this.repo.cherryPick(args.nodeId, args.target, args.author);
          return `Successfully cherry-picked into ${resultId}`;
        });
      }
    );

    this.server.tool(
      'broccolidb_compress_history',
      'Compact the recent history of a branch into a single semantic summary node',
      {
        branch: z.string().describe('Branch name'),
        summaryData: z
          .string()
          .describe(
            'The compacted JSON data representing the aggregated state/decisions. Must be valid JSON.'
          ),
        message: z.string().describe('Summary message describing what was compacted'),
        author: z.string().describe('Author name'),
      },
      async (args) => {
        return this.executeTool('compress_history', async () => {
          let parsedData: Record<string, unknown>;
          try {
            parsedData = JSON.parse(args.summaryData);
            // Basic structural validation
            if (typeof parsedData !== 'object' || parsedData === null) {
              throw new Error('summaryData must be a JSON object');
            }
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            throw new Error(`Invalid summaryData JSON: ${message}`);
          }
          const commitId = await this.repo.summarize(
            args.branch,
            parsedData,
            args.author,
            args.message
          );
          return `Successfully compacted history into summary node ${commitId}`;
        });
      }
    );

    this.server.tool(
      'broccolidb_create_scratchpad',
      'Create an isolated scratchpad branch for safe experimentation',
      {
        baseRef: z.string().describe('Branch or node to fork from (e.g. main)'),
        scratchpadName: z.string().describe('Name for the new scratchpad branch'),
      },
      async (args) => {
        return this.executeTool('create_scratchpad', async () => {
          await this.repo.createBranch(args.scratchpadName, args.baseRef);
          return `Created isolated scratchpad branch '${args.scratchpadName}' from '${args.baseRef}'`;
        });
      }
    );

    this.server.tool(
      'broccolidb_context_graph',
      'Analyze history to find files structurally correlated (frequently co-modified) with a target file.',
      {
        branch: z.string().describe('Branch name'),
        path: z.string().describe('Target file path'),
      },
      async (args) => {
        return this.executeTool('context_graph', async () => {
          const graph = await this.repo.getContextGraph(args.branch, args.path);
          return (
            graph.map((g) => `${g.path} (co-modified ${g.weight} times)`).join('\n') ||
            'No structural correlations found.'
          );
        });
      }
    );

    this.server.tool(
      'broccolidb_time_travel',
      'Rollback a branch to its exact chronological state before a given ISO timestamp.',
      {
        branch: z.string().describe('Branch name'),
        timestamp: z.string().describe('ISO 8601 timestamp (e.g. "2023-10-25T14:30:00Z")'),
        author: z.string().describe('Author initiating the rollback'),
      },
      async (args) => {
        return this.executeTool('time_travel', async () => {
          const date = new Date(args.timestamp);
          if (Number.isNaN(date.getTime())) throw new Error('Invalid ISO timestamp');
          const recoveryId = await this.repo.timeTravel(args.branch, date, args.author);
          return `Time travel successful. Branch rolled back to node: ${recoveryId}`;
        });
      }
    );

    this.server.tool(
      'broccolidb_blame',
      'Identify the last agent/author and commit that modified a specific file.',
      {
        branch: z.string().describe('Branch name'),
        path: z.string().describe('File path'),
      },
      async (args) => {
        return this.executeTool('blame', async () => {
          const blameInfo = await this.repo.blame(args.branch, args.path);
          return `Last modified by: ${blameInfo.lastAuthor}\nCommit: ${blameInfo.lastNodeId}\nMessage: ${blameInfo.lastMessage}\nTime: ${new Date(blameInfo.lastTimestamp).toISOString()}`;
        });
      }
    );

    this.server.tool(
      'broccolidb_revert',
      'Invert a specific commit/decision without dropping subsequent history.',
      {
        branch: z.string().describe('Branch name'),
        nodeId: z.string().describe('The ID of the commit to revert'),
        author: z.string().describe('Author executing the revert'),
      },
      async (args) => {
        return this.executeTool('revert', async () => {
          const commitId = await this.repo.revert(args.branch, args.nodeId, args.author);
          return `Successfully reverted ${args.nodeId}. Revert commit: ${commitId}`;
        });
      }
    );

    this.server.tool(
      'broccolidb_claim_file',
      'Claim a file for exclusive editing to prevent swarm merge conflicts.',
      {
        branch: z.string().describe('Branch name'),
        path: z.string().describe('File path to claim'),
        author: z.string().describe('Agent ID claiming the file'),
      },
      async (args) => {
        return this.executeTool('claim_file', async () => {
          await this.repo.files().claimFile(args.branch, args.path, args.author);
          return `Successfully claimed ${args.path} on ${args.branch} for ${args.author}`;
        });
      }
    );

    this.server.tool(
      'broccolidb_release_file',
      'Release an exclusive file claim.',
      {
        branch: z.string().describe('Branch name'),
        path: z.string().describe('File path to release'),
        author: z.string().describe('Agent ID releasing the file'),
      },
      async (args) => {
        return this.executeTool('release_file', async () => {
          await this.repo.files().releaseFile(args.branch, args.path, args.author);
          return `Successfully released claim on ${args.path} for ${args.author}`;
        });
      }
    );

    this.server.tool(
      'broccolidb_generate_changelog',
      'Generate a structural RAG-ready changelog summarizing the cumulative differences between two refs.',
      {
        baseRef: z.string().describe('The starting reference or branch (e.g., main)'),
        headRef: z.string().describe('The ending reference or branch (e.g., feature-branch)'),
      },
      async (args) => {
        return this.executeTool('generate_changelog', async () => {
          const changelog = await this.repo.generateChangelog(args.baseRef, args.headRef);
          return changelog;
        });
      }
    );

    this.server.tool(
      'broccolidb_recover_dropped_file',
      'Agentic Self-Healing: Scan history to find the last known state of a deleted file and resurrect it.',
      {
        branch: z.string().describe('Branch where the file was lost'),
        path: z.string().describe('Path to the lost file'),
        author: z.string().describe('Agent triggering the recovery'),
      },
      async (args) => {
        return this.executeTool('recover_dropped_file', async () => {
          const commitId = await this.repo.recoverFile(args.branch, args.path, args.author);
          return `Successfully recovered ${args.path} in new commit ${commitId}`;
        });
      }
    );

    this.server.tool(
      'broccolidb_create_ghost_branch',
      'Create an ephemeral testing branch that automatically self-destructs after 1 hour (Zero DB bloat).',
      {
        baseRef: z.string().describe('Branch or node to fork from'),
        ghostName: z.string().describe('Name for the new ghost branch'),
        ttlMinutes: z
          .number()
          .optional()
          .default(60)
          .describe('Minutes until self-destruction (default 60)'),
      },
      async (args) => {
        return this.executeTool('create_ghost_branch', async () => {
          const expiresAt = Date.now() + args.ttlMinutes * 60 * 1000;
          await this.repo.createBranch(args.ghostName, args.baseRef, {
            isEphemeral: true,
            expiresAt,
          });

          return `Created ghost branch '${args.ghostName}'. It will self-destruct in ${args.ttlMinutes} minutes (at ${new Date(expiresAt).toISOString()}).`;
        });
      }
    );

    if (this.agentContext) {
      const context = this.agentContext;
      this.server.tool(
        'broccolidb_add_knowledge',
        'Add a new node to the Knowledge Graph',
        {
          kbId: z.string().describe('Unique ID or "auto" to generate'),
          type: z
            .enum(['fact', 'vector', 'rule', 'hypothesis', 'conclusion'])
            .describe('Type of knowledge item'),
          content: z.string().describe('The knowledge payload or fact'),
          tags: z
            .string()
            .optional()
            .describe('Comma-separated list of tags (e.g., "architecture,auth")'),
          edgesJson: z
            .string()
            .optional()
            .describe('JSON string of array of GraphEdge objects: [{ targetId, type, weight }]'),
        },
        async (args) => {
          return this.executeTool('add_knowledge', async () => {
            const tagsArray = args.tags
              ? args.tags
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean)
              : [];
            let edgesArray = [];
            if (args.edgesJson) {
              edgesArray = JSON.parse(args.edgesJson);
            }
            const newId = await context.addKnowledge(args.kbId, args.type, args.content, {
              tags: tagsArray,
              edges: edgesArray,
            });
            return `Successfully added knowledge graph node: ${newId}`;
          });
        }
      );

      this.server.tool(
        'broccolidb_query_graph',
        'Search the knowledge graph using semantic similarity (cosine) or substring matching with tag filtering',
        {
          query: z.string().describe('Substring query to search within content'),
          tags: z.string().optional().describe('Comma-separated tags to filter by'),
          limit: z.number().optional().default(10).describe('Max results'),
          queryEmbeddingJson: z
            .string()
            .optional()
            .describe(
              'Optional JSON array of numbers representing the query embedding vector for cosine similarity ranking'
            ),
          augmentWithGraph: z
            .boolean()
            .optional()
            .default(false)
            .describe(
              'If true, perform 1-hop traversal from top results to include neighboring context'
            ),
        },
        async (args) => {
          return this.executeTool('kb_search', async () => {
            const results = await context.searchKnowledge(
              args.query,
              args.tags
                ? args.tags
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
                : undefined,
              args.limit,
              args.queryEmbeddingJson ? JSON.parse(args.queryEmbeddingJson) : undefined,
              { augmentWithGraph: args.augmentWithGraph }
            );
            const formatted = results
              .map(
                (r: KnowledgeBaseItem) =>
                  `[Node: ${r.itemId}] ${r.content}\nMetadata: ${JSON.stringify({
                    type: r.type,
                    confidence: r.confidence,
                    tags: r.tags,
                    edges: r.edges,
                    inboundEdges: r.inboundEdges,
                  })}`
              )
              .join('\n---\n');
            return formatted || 'No knowledge nodes found for this query.';
          });
        }
      );

      this.server.tool(
        'broccolidb_traverse_graph',
        'Traverse graph edges to find interconnected knowledge nodes with directional and type/weight filtering',
        {
          kbId: z.string().describe('The starting Knowledge Base item ID'),
          maxDepth: z
            .number()
            .optional()
            .default(2)
            .describe('Maximum number of hops (edges) to traverse'),
          direction: z
            .enum(['outbound', 'inbound', 'both'])
            .optional()
            .default('outbound')
            .describe('Edge direction to follow'),
          edgeTypes: z
            .string()
            .optional()
            .describe(
              'Comma-separated edge types to follow (supports,contradicts,blocks,depends_on,references)'
            ),
          minWeight: z.number().optional().describe('Minimum edge weight threshold (0.0–1.0)'),
        },
        async (args) => {
          return this.executeTool('kb_query', async () => {
            const filter: TraversalFilter = { direction: args.direction };
            if (args.edgeTypes) {
              filter.edgeTypes = args.edgeTypes
                .split(',')
                .map((t) => t.trim()) as GraphEdge['type'][];
            }
            if (args.minWeight !== undefined) {
              filter.minWeight = args.minWeight;
            }
            const results = await context.traverseGraph(args.kbId, args.maxDepth, filter);
            return JSON.stringify(results, null, 2);
          });
        }
      );

      this.server.tool(
        'broccolidb_get_agent_bundle',
        'Fetch a holistic intelligence bundle containing an agent profile, its active tasks, and recent unexpired graph nodes.',
        {
          agentId: z.string().describe('Agent Identity ID'),
        },
        async (args) => {
          return this.executeTool('get_agent_bundle', async () => {
            const bundle = await context.getAgentBundle(args.agentId);
            return JSON.stringify(bundle, null, 2);
          });
        }
      );

      this.server.tool(
        'broccolidb_append_memory_layer',
        "Append a long-term directive or context string to the agent's persistent Memory Layer. This context survives across tasks.",
        {
          agentId: z.string().describe('Agent Identity ID'),
          memory: z.string().describe('The context or directive string to remember'),
        },
        async (args) => {
          return this.executeTool('append_memory_layer', async () => {
            await context.appendMemoryLayer(args.agentId, args.memory);
            return `Successfully appended memory to ${args.agentId}'s memory layer.`;
          });
        }
      );

      this.server.tool(
        'broccolidb_append_shared_memory',
        'Contribute a global rule, fact or guideline to the swarm-wide shared memory layer (The "Shared Rulebook").',
        {
          memory: z
            .string()
            .describe('The context or directive string to share with the entire swarm'),
        },
        async (args) => {
          return this.executeTool('append_shared_memory', async () => {
            await context.appendSharedMemory(args.memory);
            return `Successfully appended memory to the swarm-wide shared rulebook.`;
          });
        }
      );

      this.server.tool(
        'broccolidb_spawn_task',
        'Initialize a new task for an agent.',
        {
          taskId: z.string().describe('Unique Task ID'),
          agentId: z.string().describe('Assignee Agent ID'),
          description: z.string().describe('Detailed task objective'),
          linkedKnowledgeIds: z
            .string()
            .optional()
            .describe('Comma-separated Knowledge IDs relevant to this task'),
        },
        async (args) => {
          return this.executeTool('spawn_task', async () => {
            const kbIds = args.linkedKnowledgeIds
              ? args.linkedKnowledgeIds.split(',').map((id) => id.trim())
              : [];
            await context.spawnTask(args.taskId, args.agentId, args.description, kbIds);
            return `Task '${args.taskId}' spawned successfully.`;
          });
        }
      );

      this.server.tool(
        'broccolidb_get_task_context',
        'Generate a perfect contextual window for an agent working on a specific task, resolving the multi-hop graph of required knowledge automatically.',
        {
          taskId: z.string().describe('The ID of the task to resolve context for'),
        },
        async (args) => {
          return this.executeTool('get_task_context', async () => {
            const taskContext = await context.getTaskContext(args.taskId);
            return JSON.stringify(taskContext, null, 2);
          });
        }
      );

      // ─── KNOWLEDGE LIFECYCLE TOOLS ───

      this.server.tool(
        'broccolidb_update_knowledge',
        'Partially update a knowledge graph node (content, tags, edges, confidence). Automatically reconciles bidirectional edge index.',
        {
          kbId: z.string().describe('The Knowledge Base item ID to update'),
          content: z.string().optional().describe('New content (replaces existing)'),
          tags: z.string().optional().describe('Comma-separated new tags (replaces existing)'),
          edgesJson: z
            .string()
            .optional()
            .describe('JSON array of new GraphEdge objects (replaces existing edges)'),
          confidence: z.number().optional().describe('New confidence score (0.0–1.0)'),
        },
        async (args) => {
          return this.executeTool('update_knowledge', async () => {
            const patch: Record<string, unknown> = {};
            if (args.content !== undefined) patch.content = args.content;
            if (args.tags !== undefined)
              patch.tags = args.tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean);
            if (args.edgesJson !== undefined) patch.edges = JSON.parse(args.edgesJson);
            if (args.confidence !== undefined) patch.confidence = args.confidence;
            await context.updateKnowledge(args.kbId, patch);
            return `Successfully updated knowledge node: ${args.kbId}`;
          });
        }
      );

      this.server.tool(
        'broccolidb_delete_knowledge',
        'Delete a knowledge graph node and clean up all bidirectional edge references on connected nodes.',
        {
          kbId: z.string().describe('The Knowledge Base item ID to delete'),
        },
        async (args) => {
          return this.executeTool('kb_register', async () => {
            await context.deleteKnowledge(args.kbId);
            return `Successfully deleted knowledge node: ${args.kbId}`;
          });
        }
      );

      this.server.tool(
        'broccolidb_merge_knowledge',
        'Fold one knowledge node into another: unions tags, concatenates content, re-points edges, averages confidence, deletes source.',
        {
          sourceId: z.string().describe('The knowledge node to fold (will be deleted)'),
          targetId: z
            .string()
            .describe('The knowledge node to merge into (will be preserved and enriched)'),
        },
        async (args) => {
          return this.executeTool('kb_link', async () => {
            await context.mergeKnowledge(args.sourceId, args.targetId);
            return `Successfully merged ${args.sourceId} into ${args.targetId}. Source deleted.`;
          });
        }
      );

      // ─── GRAPH ANALYTICS TOOLS ───

      this.server.tool(
        'broccolidb_node_centrality',
        'Get degree centrality metrics for a knowledge node (inbound + outbound edge count). Higher = more connected hub.',
        {
          kbId: z.string().describe('The Knowledge Base item ID'),
        },
        async (args) => {
          return this.executeTool('node_centrality', async () => {
            const result = await context.getNodeCentrality(args.kbId);
            return `Node: ${result.kbId}\nInbound Edges: ${result.inbound}\nOutbound Edges: ${result.outbound}\nTotal Degree Centrality: ${result.totalDegree}`;
          });
        }
      );

      this.server.tool(
        'broccolidb_extract_subgraph',
        'Extract a self-contained serializable subgraph from a root node — perfect for injecting into an LLM context window.',
        {
          rootId: z.string().describe('The root Knowledge Base item ID'),
          maxDepth: z.number().optional().default(2).describe('Maximum traversal depth'),
          direction: z
            .enum(['outbound', 'inbound', 'both'])
            .optional()
            .default('both')
            .describe('Edge direction'),
          edgeTypes: z.string().optional().describe('Comma-separated edge types to follow'),
        },
        async (args) => {
          return this.executeTool('extract_subgraph', async () => {
            const filter: TraversalFilter = { direction: args.direction };
            if (args.edgeTypes) {
              filter.edgeTypes = args.edgeTypes
                .split(',')
                .map((t) => t.trim()) as GraphEdge['type'][];
            }
            const subgraph = await context.extractSubgraph(args.rootId, args.maxDepth, filter);
            return JSON.stringify(subgraph, null, 2);
          });
        }
      );

      // ─── CONFIDENCE DECAY TOOL ───

      this.server.tool(
        'broccolidb_decay_confidence',
        'Batch decay confidence on knowledge nodes older than a threshold. Multiplies existing confidence by the given factor.',
        {
          factor: z
            .number()
            .describe('Decay multiplier (0.0–1.0). E.g., 0.9 reduces confidence by 10%.'),
          olderThanIso: z
            .string()
            .describe('ISO 8601 timestamp. Only nodes created before this date are affected.'),
        },
        async (args) => {
          return this.executeTool('decay_confidence', async () => {
            const olderThan = new Date(args.olderThanIso);
            if (Number.isNaN(olderThan.getTime())) throw new Error('Invalid ISO timestamp');
            const result = await context.decayConfidence(args.factor, olderThan);
            return `Confidence decay applied. ${result.decayedCount} nodes affected.`;
          });
        }
      );

      // ─── EMBEDDING TOOLS ───

      this.server.tool(
        'broccolidb_embed_knowledge',
        "Force (re-)embed a specific knowledge node using Gemini Embedding 2. Updates the node's embedding vector in-place.",
        {
          kbId: z.string().describe('The Knowledge Base item ID to embed'),
        },
        async (args) => {
          try {
            const node = await context.getKnowledge(args.kbId);
            await context.updateKnowledge(args.kbId, { content: node.content });
            const updated = await context.getKnowledge(args.kbId);
            const dims = updated.embedding ? updated.embedding.length : 0;
            return {
              content: [
                {
                  type: 'text',
                  text: `Successfully embedded node ${args.kbId}. Vector dimensions: ${dims}`,
                },
              ],
            };
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
          }
        }
      );

      this.server.tool(
        'broccolidb_semantic_search',
        'Search the knowledge graph by natural language. Auto-embeds the query using Gemini Embedding 2 and ranks results by cosine similarity.',
        {
          query: z.string().describe('Natural language search query'),
          tags: z.string().optional().describe('Comma-separated tags to filter by'),
          limit: z.number().optional().default(10).describe('Max results'),
          augmentWithGraph: z
            .boolean()
            .optional()
            .default(false)
            .describe(
              'If true, perform 1-hop traversal from top results to include neighboring context'
            ),
        },
        async (args) => {
          try {
            const tagsArray = args.tags
              ? args.tags
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean)
              : undefined;
            const results = await context.searchKnowledge(
              args.query,
              tagsArray,
              args.limit,
              undefined,
              { augmentWithGraph: args.augmentWithGraph }
            );
            const formatted = results
              .map((r: KnowledgeBaseItem) => {
                const embDims = r.embedding?.length ?? 0;
                return `[${r.itemId}] (${r.type}) conf:${r.confidence ?? 1.0} embed:${embDims}d tags:[${r.tags.join(', ')}]\n${r.content}`;
              })
              .join('\n\n');
            return { content: [{ type: 'text', text: formatted || 'No results found.' }] };
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
          }
        }
      );

      this.server.tool(
        'broccolidb_reembed_all',
        'Batch re-embed all knowledge nodes using Gemini Embedding 2. Useful when migrating to a new embedding model.',
        {},
        async () => {
          try {
            const result = await context.reembedAll();
            return {
              content: [
                {
                  type: 'text',
                  text: `Batch re-embedding complete. Embedded: ${result.embeddedCount}, Skipped: ${result.skippedCount}`,
                },
              ],
            };
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
          }
        }
      );

      this.server.tool(
        'broccolidb_get_telemetry',
        'Audit your own intelligence usage: Get real-time cost, token, and commit telemetry for the current agent or task.',
        {
          agentId: z.string().optional().describe('Filter by specific Agent ID'),
          taskId: z.string().optional().describe('Filter by specific Task ID'),
        },
        async (args) => {
          try {
            const stats = await EnvironmentTracker.getStats(
              this.repo.getDb(),
              this.repo.getBasePath(),
              args.agentId,
              args.taskId
            );
            const report = EnvironmentTracker.getReport(stats);
            return { content: [{ type: 'text', text: report }] };
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
          }
        }
      );

      this.server.tool(
        'broccolidb_context_cache_stats',
        'Audit the ultra-low latency (<200ms) graph in-memory cache. View hits, misses, and current size.',
        {},
        async () => {
          try {
            const stats = context.getCacheStats();
            return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
          }
        }
      );

      this.server.tool(
        'broccolidb_get_top_hubs',
        'Intelligent Onboarding: Identify the most important "Hub" nodes in the global knowledge graph for rapid cognitive indexing.',
        {
          limit: z.number().optional().default(10).describe('Max number of hubs to return'),
        },
        async (args) => {
          try {
            const hubs = await context.getGlobalCentrality(args.limit);
            const formatted = hubs
              .map(
                (h: { kbId: string; score: number }) =>
                  `Node: ${h.kbId} | Centrality Score: ${h.score}`
              )
              .join('\n');
            return { content: [{ type: 'text', text: formatted || 'No hubs discovered yet.' }] };
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
          }
        }
      );

      this.server.tool(
        'broccolidb_simulate_merge',
        'Speculative Execution: High-performance Merkle-based conflict forecasting and blast radius analysis.',
        {
          source: z.string().describe('Source branch or ref'),
          target: z.string().describe('Target branch or ref'),
        },
        async (args) => {
          try {
            const result = await this.repo.simulateMerge(args.source, args.target);
            const formatted = `
=== Speculative Merge: ${args.source} -> ${args.target} ===
LCA: ${result.lcaId || 'None'}
Status: ${result.hasConflicts ? '❌ CONFLICT' : '✅ CLEAN'}
Conflicts: ${result.conflicts.join(', ') || 'None'}
Affected Paths: ${result.affectedPaths.join(', ') || 'None'}
            `.trim();
            return { content: [{ type: 'text', text: formatted }] };
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
          }
        }
      );
    }

    // ─── SYSTEM MAINTENANCE TOOLS ───

    this.server.tool(
      'broccolidb_cache_stats',
      'View operations statistics for the in-memory LRU tree cache.',
      {},
      async () => {
        const stats = this.repo.getTreeCacheStats();
        return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
      }
    );

    this.server.tool(
      'broccolidb_flush_telemetry',
      'Force flush the async telemetry queue. Useful before shutting down the Agent context.',
      {},
      async () => {
        const statsBefore = await telemetryQueue.getStats();
        await telemetryQueue.drain();
        return {
          content: [
            {
              type: 'text',
              text: `Telemetry queue drained. Processed ${statsBefore.pending} pending items.`,
            },
          ],
        };
      }
    );

    this.server.tool(
      'broccolidb_proactive_audit',
      'Trigger AI-driven discovery to find unlinked but logically related knowledge nodes.',
      {
        nodeId: z.string().describe('Target node ID to start discovery from'),
      },
      async (args) => {
        return this.executeTool('proactive_audit', async () => {
          if (!this.agentContext) return 'AgentContext not available.';
          const result = await this.agentContext.autoDiscoverRelationships(args.nodeId);
          return `Proactive Audit Complete.\nNodes discovered: ${result.discovered}\nSuggestions:\n${result.suggestions.join('\n')}`;
        });
      }
    );

    this.server.tool(
      'broccolidb_describe_pedigree',
      'Generate a natural language narrative explaining how a conclusion was reached.',
      {
        nodeId: z.string().describe('Node ID of the conclusion'),
      },
      async (args) => {
        return this.executeTool('describe_pedigree', async () => {
          if (!this.agentContext) return 'AgentContext not available.';
          return await this.agentContext.getNarrativePedigree(args.nodeId);
        });
      }
    );

    this.server.tool(
      'broccolidb_speculate_fact',
      'Evaluate the hypothetical impact of a fact against the existing knowledge graph.',
      {
        content: z.string().describe('The hypothetical fact content'),
        startId: z
          .string()
          .optional()
          .describe('Optional starting node for soundness delta calculation'),
      },
      async (args) => {
        return this.executeTool('speculate_fact', async () => {
          if (!this.agentContext) return 'AgentContext not available.';
          const report = await this.agentContext.speculateImpact(args.content, args.startId);
          let output = `[Speculative Impact Report]\nValid: ${report.isValid}\nSoundness Delta: ${report.soundnessDelta}\n\n`;
          if (report.contradictions.length > 0) {
            output += `Contradictions Identified:\n`;
            for (const c of report.contradictions) {
              output += ` - Conflicts with: ${c.conflictingNodeId}\n`;
            }
          }
          if (report.suggestions.length > 0) {
            output += `\nSuggestions:\n${report.suggestions.join('\n')}`;
          }
          return output;
        });
      }
    );

    this.server.tool(
      'broccolidb_bind_rule',
      'Bind a logical rule (knowledgeId) to a specific path pattern (constitution).',
      {
        pathPattern: z.string().describe('Glob-like pattern (e.g. src/core/*)'),
        knowledgeId: z.string().describe('ID of the knowledge node containing the rule'),
        severity: z
          .enum(['blocking', 'warning'])
          .optional()
          .default('blocking')
          .describe('Audit severity'),
      },
      async (args) => {
        return this.executeTool('bind_rule', async () => {
          if (!this.agentContext) return 'AgentContext not available.';
          await this.agentContext.addLogicalConstraint(
            args.pathPattern,
            args.knowledgeId,
            args.severity
          );
          return `Successfully bound rule ${args.knowledgeId} to ${args.pathPattern} (${args.severity})`;
        });
      }
    );

    this.server.tool(
      'broccolidb_get_constitution',
      'Retrieve all logical path-bound constraints for the current repository.',
      {},
      async () => {
        return this.executeTool('get_constitution', async () => {
          if (!this.agentContext) return 'AgentContext not available.';
          const constraints = await this.agentContext.getLogicalConstraints();
          if (constraints.length === 0) return 'No constitutional constraints defined.';
          return (
            `[Repository Constitution]\n` +
            constraints
              .map((c) => `- ${c.pathPattern}: ${c.knowledgeId} [${c.severity}]`)
              .join('\n')
          );
        });
      }
    );
  }

  /**
   * Starts the MCP server via standard I/O streams.
   * This is how agent clients like Cursor or Claude Desktop connect natively.
   */
  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
