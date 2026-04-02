import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { DEFAULT_DATABASE_NAME } from '../backend/src/config/brand.js';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.join(__dirname, 'schema.sql');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:postgres@localhost:5432/${DEFAULT_DATABASE_NAME}`;

async function initDB() {
  const client = new Client({ connectionString, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
  await client.connect();

  try {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await client.query(sql);
    console.log(`Schema aplicado correctamente sobre ${connectionString}`);
  } finally {
    await client.end();
  }
}

initDB().catch((error) => {
  console.error('No fue posible aplicar database/schema.sql');
  console.error(error);
  process.exitCode = 1;
});
