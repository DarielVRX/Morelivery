import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.nodeEnv === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('error', (error) => {
  console.error('[db.pool.error]', { message: error.message, code: error.code });
});

export async function query(text, params = []) {
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (error) {
    console.error('[db.query.error]', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      table: error.table,
      constraint: error.constraint
    });
    throw error;
  }
}

export async function checkDbConnection() {
  const result = await query('SELECT NOW() as now');
  return result.rows[0];
}
