import assert from 'node:assert';
import fs from 'node:fs';
import { dbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const dbPath = './test-builder.db';
  setDbPath(dbPath);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  await dbPool.start();

  try {
    console.info('--- TEST: Fluent Query Builder Ergonomics ---');

  // 1. Test InsertBuilder
  console.info('Testing insertInto().values().execute()...');
  await dbPool.insertInto('users')
    .values({ id: 'user-1', createdAt: Date.now() })
    .execute();

  await dbPool.insertInto('users')
    .values([
      { id: 'user-2', createdAt: Date.now() },
      { id: 'user-3', createdAt: Date.now() }
    ])
    .execute();

  // 2. Test QueryBuilder (select)
  console.info('Testing selectFrom().where().execute()...');
  const user1 = await dbPool.selectFrom('users')
    .where('id', '=', 'user-1')
    .executeTakeFirst();
  assert.ok(user1, 'Failed to fetch user-1');
  assert.strictEqual(user1.id, 'user-1');

  const allUsers = await dbPool.selectFrom('users')
    .orderBy('id', 'asc')
    .execute();
  assert.strictEqual(allUsers.length, 3, 'Should have inserted 3 users');
  assert.strictEqual(allUsers[0].id, 'user-1');
  assert.strictEqual(allUsers[1].id, 'user-2');
  assert.strictEqual(allUsers[2].id, 'user-3');

  // Test executeTakeFirst and selectOne return the first match
  const firstUser = await dbPool.selectFrom('users')
    .orderBy('id', 'asc')
    .executeTakeFirst();
  assert.ok(firstUser, 'executeTakeFirst returned null');
  assert.strictEqual(firstUser.id, 'user-1', 'executeTakeFirst should return the first matching element');

  const firstUserOne = await dbPool.selectOne('users', []);
  assert.ok(firstUserOne, 'selectOne returned null');
  assert.strictEqual(firstUserOne.id, 'user-1', 'selectOne should return the first matching element');

  // 3. Test UpdateBuilder
  console.info('Testing updateTable().set().where().execute()...');
  await dbPool.updateTable('users')
    .set({ createdAt: 123456789 })
    .where('id', '=', 'user-2')
    .execute();

  // Flush to make sure it's written and queries can see it
  await dbPool.flush();

  const user2 = await dbPool.selectFrom('users')
    .where('id', 'user-2')
    .executeTakeFirst();
  assert.ok(user2, 'Failed to fetch user-2');
  assert.strictEqual(Number(user2.createdAt), 123456789, 'Update failed');

  // 4. Test DeleteBuilder
  console.info('Testing deleteFrom().where().execute()...');
  await dbPool.deleteFrom('users')
    .where('id', '=', 'user-3')
    .execute();

  await dbPool.flush();

  const deletedUser = await dbPool.selectFrom('users')
    .where('id', 'user-3')
    .executeTakeFirst();
  assert.strictEqual(deletedUser, null, 'User should be deleted');

  const remainingUsers = await dbPool.selectFrom('users').execute();
  assert.strictEqual(remainingUsers.length, 2, 'Should have 2 users remaining');

  // 5. Test Deduplication of memory inserts/updates
  console.info('Testing memory-level deduplication...');
  await dbPool.insertInto('users').values({ id: 'user-dup-test', createdAt: 100 }).execute();
  await dbPool.insertInto('users').values({ id: 'user-dup-test', createdAt: 200 }).execute();
  
  const dupSelect = await dbPool.selectFrom('users').where('id', '=', 'user-dup-test').execute();
  assert.strictEqual(dupSelect.length, 1, 'Memory query returned duplicate rows');
  assert.strictEqual(Number(dupSelect[0]?.createdAt), 200, 'Memory query returned stale row values');
  await dbPool.flush();

  // 6. Test Dead Letter Queue (DLQ)
  console.info('Testing Dead Letter Queue (DLQ)...');
  dbPool.clearDeadLetterQueue();
  // Insert a workspace with a non-existent userId, violating foreign key constraint
  await dbPool.insertInto('workspaces').values({
    id: 'workspace-invalid',
    userId: 'nonexistent-user-id',
    sharedMemoryLayer: '[]',
    createdAt: Date.now()
  }).execute();
  
  try {
    await dbPool.flush();
  } catch (err) {
    // Expected constraint violation error
  }
  
  const dlq = dbPool.getDeadLetterQueue();
  assert.ok(dlq.length > 0, 'DLQ did not capture the failed operation');
  assert.strictEqual(dlq[0]?.op.table, 'workspaces', 'DLQ captured wrong table operation');
  assert.ok(dlq[0]?.error.includes('FOREIGN KEY constraint failed'), 'DLQ captured wrong error: ' + dlq[0]?.error);
  dbPool.clearDeadLetterQueue();

    console.info('✅ ALL QUERY BUILDER TESTS PASSED.');
  } finally {
    await dbPool.stop();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
}

runTest().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
