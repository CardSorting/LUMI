// [LAYER: UI]
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

const BENCH_DB = path.resolve(process.cwd(), 'benchmark.db');
const NUM_OPS = 1000000;
const BATCH_SIZE = 4000;

async function runBenchmark() {
  console.log('🚀 Starting BroccoliDB High-Performance Benchmark');
  console.log(
    `📊 Parameters: ${NUM_OPS.toLocaleString()} ops, Batch Size: ${BATCH_SIZE.toLocaleString()}`
  );

  // 0. Cleanup and Init
  if (fs.existsSync(BENCH_DB)) fs.unlinkSync(BENCH_DB);
  if (fs.existsSync(`${BENCH_DB}-wal`)) fs.unlinkSync(`${BENCH_DB}-wal`);
  if (fs.existsSync(`${BENCH_DB}-shm`)) fs.unlinkSync(`${BENCH_DB}-shm`);

  setDbPath(BENCH_DB);
  await dbPool.start();
  console.log(`📂 Database: ${BENCH_DB}`);

  // Insert users to satisfy foreign key constraints
  await dbPool.insertInto('users').values([
    { id: 'bench-user', createdAt: Date.now() },
    { id: 'stress-user', createdAt: Date.now() }
  ]).execute();
  await dbPool.flush();

  // --- TEST 1: BufferedDbPool Raw Throughput ---
  console.log('\n--- PHASE 1: BufferedDbPool Raw Throughput ---');
  const start1 = performance.now();

  for (let i = 0; i < NUM_OPS; i += BATCH_SIZE) {
    const ops = [];
    for (let j = 0; j < BATCH_SIZE; j++) {
      ops.push({
        type: 'insert' as const,
        table: 'knowledge' as const,
        values: {
          id: `bench-node-${i + j}`,
          userId: 'bench-user',
          type: 'benchmark_data',
          content: JSON.stringify({ data: 'x'.repeat(100) }), // 100 bytes of content
          createdAt: Date.now(),
        },
        layer: 'infrastructure' as const,
      });
    }
    await dbPool.pushBatch(ops);
  }

  console.log('⏳ Waiting for final flush...');
  await dbPool.flush();
  const end1 = performance.now();
  const duration1 = (end1 - start1) / 1000;
  const throughput1 = Math.round(NUM_OPS / duration1);

  console.log(`✅ Phase 1 Complete: ${NUM_OPS.toLocaleString()} ops in ${duration1.toFixed(2)}s`);
  console.log(`📈 BufferedDbPool Throughput: ${throughput1.toLocaleString()} ops/sec`);



  // --- TEST 4: Multi-Agent Concurrency Stress (Level 3) ---
  console.log('\n--- PHASE 4: Multi-Agent Concurrency Stress (Level 3) ---');
  const NUM_AGENTS = 20;
  const OPS_PER_AGENT = Math.floor(NUM_OPS / NUM_AGENTS);
  console.log(
    `👥 Running with ${NUM_AGENTS} concurrent agents pushing ${OPS_PER_AGENT.toLocaleString()} ops each...`
  );

  const agentStart = performance.now();
  const agentTasks = [];

  for (let a = 0; a < NUM_AGENTS; a++) {
    agentTasks.push(
      (async () => {
        const agentId = `agent-${a}`;
        for (let i = 0; i < OPS_PER_AGENT; i += BATCH_SIZE) {
          const ops = [];
          for (let j = 0; j < BATCH_SIZE && i + j < OPS_PER_AGENT; j++) {
            ops.push({
              type: 'insert' as const,
              table: 'knowledge' as const,
              values: {
                id: `concurrent-${a}-${i + j}`,
                userId: 'stress-user',
                type: 'benchmark_data',
                content: 'x'.repeat(100),
                createdAt: Date.now(),
              },
              layer: 'infrastructure' as const,
            });
          }
          await dbPool.pushBatch(ops, agentId); // Use agentId to test shadow/state locking
          await dbPool.commitWork(agentId);
        }
      })()
    );
  }

  await Promise.all(agentTasks);
  await dbPool.flush();
  const agentEnd = performance.now();
  const agentDuration = (agentEnd - agentStart) / 1000;
  const agentThroughput = Math.round(NUM_OPS / agentDuration);

  console.log(
    `✅ Phase 4 Complete: ${NUM_OPS.toLocaleString()} ops in ${agentDuration.toFixed(2)}s`
  );
  console.log(`📈 Multi-Agent Throughput: ${agentThroughput.toLocaleString()} ops/sec`);

  // --- REPORT ---
  const metrics = dbPool.getMetrics();
  const physicalTrans = (metrics as any).totalTransactions || 1;
  const logicalTotals = NUM_OPS * 2; // 2 phases now (raw and concurrent)
  const logicalPerPhysical = Math.round(logicalTotals / physicalTrans);

  console.log('\n--- FINAL PERFORMANCE REPORT (v2) ---');
  console.log(`Avg Logical DB Throughput: ${throughput1.toLocaleString()} ops/sec`);
  console.log(`Multi-Agent Throughput:   ${agentThroughput.toLocaleString()} ops/sec`);
  console.log(`Physical Transactions:    ${physicalTrans}`);
  console.log(`Logical/Physical Ratio:   ${logicalPerPhysical}:1`);
  console.log(`p95 Enqueue Latency:     ${metrics.latencies.enqueue.p95.toFixed(3)}ms`);
  console.log(`p99 Enqueue Latency:     ${metrics.latencies.enqueue.p99.toFixed(3)}ms`);
  console.log(`p95 Processing Latency:  ${metrics.latencies.processing.p95.toFixed(2)}ms`);
  console.log(`p99 Processing Latency:  ${metrics.latencies.processing.p99.toFixed(2)}ms`);

  // Final Cleanup
  await dbPool.stop();
  process.exit(0);
}

runBenchmark().catch((err) => {
  console.error('❌ Benchmark Failed:', err);
  process.exit(1);
});
