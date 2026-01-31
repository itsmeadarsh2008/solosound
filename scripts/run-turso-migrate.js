#!/usr/bin/env node
import { createClient } from '@libsql/client';
import fs from 'fs/promises';

const tursoUrl = process.env.TURSO_DATABASE_URL || "file:./local.db";
const tursoToken = process.env.TURSO_AUTH_TOKEN;

async function run() {
  const db = createClient({ url: tursoUrl, authToken: tursoToken });
  const sql = await fs.readFile(new URL('../functions/turso-migrate.sql', import.meta.url), 'utf-8');
  const statements = sql.split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  for (const stmt of statements) {
    console.log('Executing:', stmt.split('\n')[0].slice(0, 120));
    try {
      await db.execute(stmt);
    } catch (err) {
      console.error('Error executing:', stmt.split('\n')[0]);
      console.error(err);
      throw err;
    }
  }
  console.log('Migration complete');
}

run().catch((err) => { console.error(err); process.exit(1); });
