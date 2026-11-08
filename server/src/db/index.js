import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/index.js';

const here = dirname(fileURLToPath(import.meta.url));

export function openDb(path = config.dbPath) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(resolve(here, 'schema.sql'), 'utf8'));
  // Migration for databases created before the interviewer's per-turn assessment was stored.
  const cols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
  if (!cols.includes('meta')) db.exec('ALTER TABLE messages ADD COLUMN meta TEXT');
  return db;
}
