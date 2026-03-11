import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const { Client } = pg;

const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

test('database connection responds to a simple query', async (t) => {
  if (!connectionString) {
    t.skip('TEST_DATABASE_URL or DATABASE_URL is not configured');
    return;
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 3_000
  });

  await client.connect();

  try {
    const { rows } = await client.query('select 1 as ok');
    assert.equal(rows[0]?.ok, 1);
  } finally {
    await client.end();
  }
});
