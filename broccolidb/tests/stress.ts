import * as fs from 'node:fs';
import * as path from 'node:path';
import { dbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

const BENCH_DB = path.resolve(process.cwd(), 'stress.db');
const TOTAL_OPS = 200000;
const AGENTS = 10;
const OPS_PER_AGENT = TOTAL_OPS / AGENTS;

async function runStress() {
  console.log('🚀 Starting Multi-Agent Concurrency Stress Test');
  console.log('👥 Agents:', AGENTS);
  console.log('📝 Ops/Agent:', OPS_PER_AGENT.toLocaleString());

  if (fs.existsSync(BENCH_DB)) fs.unlinkSync(BENCH_DB);
  setDbPath(BENCH_DB);

  const start = performance.now();

  const tasks = [];
  for (let a = 0; a < AGENTS; a++) {
    tasks.push(
      (async () => {
        for (let i = 0; i < OPS_PER_AGENT; i += 1000) {
          const ops = [];
          for (let j = 0; j < 1000; j++) {
            ops.push({
              type: 'insert' as const,
              table: 'knowledge' as const,
              values: {
                id: `stress-${a}-${i + j}`,
                userId: 'stress-user',
                type: 'benchmark_data',
                content: 'x'.repeat(100),
                createdAt: Date.now(),
              },
              layer: 'infrastructure' as const,
            });
          }
          await dbPool.pushBatch(ops);
        }
      })()
    );
  }

  await Promise.all(tasks);
  await dbPool.flush();

  const duration = (performance.now() - start) / 1000;
  console.log(`✅ Finished in ${duration.toFixed(2)}s`);
  console.log(`📈 Throughput: ${Math.round(TOTAL_OPS / duration).toLocaleString()} ops/sec`);

  await dbPool.stop();
}

runStress().catch(console.error);
