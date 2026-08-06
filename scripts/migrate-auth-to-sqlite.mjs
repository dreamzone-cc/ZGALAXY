#!/usr/bin/env node
// Migrate existing JSON auth data (users.json, sessions.json) into SQLite.
//
// Usage:
//   node scripts/migrate-auth-to-sqlite.mjs --config /path/to/config
//   bun run scripts/migrate-auth-to-sqlite.mjs --config /path/to/config
//
// Requires Node.js >= 22.5 (node:sqlite) or Bun (bun:sqlite). After migration,
// start the engine with USE_SQLITE=1 to use the SQLite store.

const isBun = typeof process !== 'undefined' && !!process.versions?.bun;
const { DatabaseSync } = isBun
  ? await import('bun:sqlite').then((m) => ({ DatabaseSync: m.Database }))
  : await import('node:sqlite');

const args = process.argv.slice(2);
const configDir =
  (args.indexOf('--config') >= 0 && args[args.indexOf('--config') + 1]) ||
  process.env.CONFIG_PATH ||
  new URL('../config', import.meta.url).pathname;

const dbPath = `${configDir}/zgalaxy.db`;
const usersPath = `${configDir}/users.json`;
const sessionsPath = `${configDir}/sessions.json`;

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY NOT NULL,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('ADMIN','OPERATOR','READ_ONLY')),
    created_at    TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY NOT NULL,
    username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('ADMIN','OPERATOR','READ_ONLY')),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
`);

const insertUser = db.prepare(
  'INSERT OR REPLACE INTO users (username, password_hash, salt, role, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)'
);
const insertSession = db.prepare(
  'INSERT OR IGNORE INTO sessions (token, username, role, created_at) VALUES (?, ?, ?, ?)'
);

let usersMigrated = 0;
if (await exists(usersPath)) {
  const users = JSON.parse(await readFile(usersPath));
  db.exec('BEGIN');
  try {
    for (const u of users) {
      insertUser.run(u.username, u.passwordHash, u.salt, u.role, u.createdAt, u.lastLoginAt || null);
      usersMigrated++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  console.log(`Migrated ${usersMigrated} users -> ${dbPath}`);
} else {
  console.log('No users.json found; skipping users.');
}

let sessionsMigrated = 0;
if (await exists(sessionsPath)) {
  const sessions = JSON.parse(await readFile(sessionsPath));
  db.exec('BEGIN');
  try {
    for (const s of sessions) {
      insertSession.run(s.token, s.username, s.role, s.createdAt);
      sessionsMigrated++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  console.log(`Migrated ${sessionsMigrated} sessions -> ${dbPath}`);
} else {
  console.log('No sessions.json found; skipping sessions.');
}

console.log('Done. Start the engine with USE_SQLITE=1 to use the SQLite auth store.');
db.close();

async function exists(p) {
  try {
    await import('node:fs/promises').then(({ access }) => access(p));
    return true;
  } catch {
    return false;
  }
}

async function readFile(p) {
  return await import('node:fs/promises').then(({ readFile }) => readFile(p, 'utf8'));
}
