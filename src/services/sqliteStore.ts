import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { config } from '../engine/config';

/**
 * SQLite-backed storage for users and sessions (auth store).
 *
 * Enabled by default on runtimes that support it (Bun or Node >= 22.5 with
 * node:sqlite). Set USE_SQLITE=0 to force the JSON store, or USE_SQLITE=1 to
 * force SQLite. Uses WAL mode, UNIQUE/CHECK constraints and busy_timeout.
 *
 * On first use it auto-imports an existing users.json/sessions.json (if any)
 * so upgrading an existing JSON deployment is seamless; otherwise it seeds the
 * same default admin account the JSON store would have created.
 *
 * The sqlite driver is imported dynamically so the engine also boots on
 * runtimes without one of the drivers (falls back to JSON mode).
 */
let _db: any = null;
let _initPromise: Promise<any> | null = null;

function detectDriver(): 'bun' | 'node' | 'none' {
  if (typeof process === 'undefined') return 'none';
  if (!!(process as any).versions?.bun) return 'bun';
  if (process.versions.node) {
    const [maj, min] = process.versions.node.split('.').map(Number);
    if (maj > 22 || (maj === 22 && min >= 5)) return 'node';
  }
  return 'none';
}

function runtimeSupportsSqlite(): boolean {
  return detectDriver() !== 'none';
}

async function initDb(): Promise<any> {
  if (_db) return _db;
  if (!_initPromise) {
    _initPromise = (async () => {
      const dbPath = path.join(config.configPath, 'zgalaxy.db');
      const driver = detectDriver();
      if (driver === 'bun') {
        // @ts-expect-error - bun:sqlite types come from @types/bun, absent here
        const { Database } = await import('bun:sqlite');
        _db = new Database(dbPath);
        _db.exec('PRAGMA journal_mode = WAL;');
        _db.exec('PRAGMA foreign_keys = ON;');
        _db.exec('PRAGMA busy_timeout = 5000;');
      } else {
        const { DatabaseSync } = await import('node:sqlite');
        _db = new DatabaseSync(dbPath);
        _db.exec('PRAGMA journal_mode = WAL');
        _db.exec('PRAGMA foreign_keys = ON');
        _db.exec('PRAGMA busy_timeout = 5000');
      }
      _db.exec(`
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
      await migrateLegacyJson();
      return _db;
    })().catch((err) => {
      // A transient init failure must not poison every subsequent call.
      _initPromise = null;
      throw err;
    });
  }
  return _initPromise;
}

/** One-time import of legacy JSON stores + default-admin seeding (seamless upgrade). */
async function migrateLegacyJson(): Promise<void> {
  const usersPath = path.join(config.configPath, 'users.json');
  const sessionsPath = path.join(config.configPath, 'sessions.json');
  const insertUser = _db.prepare(
    'INSERT OR REPLACE INTO users (username, password_hash, salt, role, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertSession = _db.prepare('INSERT OR IGNORE INTO sessions (token, username, role, created_at) VALUES (?, ?, ?, ?)');

  const userCount = _db.prepare('SELECT COUNT(*) AS c FROM users').get() as any;
  if (userCount.c === 0) {
    if (fs.existsSync(usersPath)) {
      try {
        const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
        _db.exec('BEGIN');
        try {
          for (const u of users) {
            insertUser.run(u.username, u.passwordHash, u.salt, u.role, u.createdAt, u.lastLoginAt || null);
          }
          _db.exec('COMMIT');
        } catch (e) {
          _db.exec('ROLLBACK');
          throw e;
        }
      } catch (e) {
        console.warn('[ZGALAXY SQLITE] Failed to import users.json:', (e as Error).message);
      }
    }
    // Seed only when the users table is still empty after the import attempt
    // (missing users.json OR a failed import) — never boot without a
    // loginable admin.
    const usersStillEmpty = ((_db.prepare('SELECT COUNT(*) AS c FROM users').get() as any).c === 0);
    if (usersStillEmpty) {
      // Seed the same default admin the JSON store would create, but with a
      // RANDOM initial password written to a bootstrap file (never the
      // well-known default).
      const salt = crypto.randomBytes(16).toString('hex');
      const initialPassword = crypto.randomBytes(18).toString('base64url');
      const hash = crypto
        .pbkdf2Sync(initialPassword, salt, 210000, 64, 'sha512')
        .toString('hex');
      insertUser.run('admin', hash, salt, 'ADMIN', new Date().toISOString(), null);
      try {
        const bootstrapFile = path.join(config.configPath, 'admin_initial_password.txt');
        fs.writeFileSync(
          bootstrapFile,
          `ZGALAXY default admin created.\nusername: admin\npassword: ${initialPassword}\nCHANGE THIS PASSWORD IMMEDIATELY (then delete this file).\n`,
          { mode: 0o600 }
        );
      } catch (e) {
        console.warn('[ZGALAXY SQLITE] Could not write admin bootstrap file:', (e as Error).message);
      }
    }
  }

  const sessionCount = _db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as any;
  if (sessionCount.c === 0 && fs.existsSync(sessionsPath)) {
    try {
      const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
      // INSERT OR IGNORE does not cover FOREIGN KEY violations, so orphaned
      // sessions (deleted users) must be filtered explicitly — and one bad
      // row must not roll back the whole import (it logged everyone out).
      const usernames = new Set(
        (_db.prepare('SELECT username FROM users').all() as any[]).map((r) => r.username)
      );
      let imported = 0;
      let skipped = 0;
      for (const s of sessions) {
        if (!s?.username || !usernames.has(s.username)) {
          skipped++;
          continue;
        }
        try {
          insertSession.run(s.token, s.username, s.role, s.createdAt);
          imported++;
        } catch {
          skipped++;
        }
      }
      console.log(
        `[ZGALAXY SQLITE] sessions.json import: ${imported} imported, ${skipped} skipped (orphaned/invalid)`
      );
    } catch (e) {
      console.warn('[ZGALAXY SQLITE] Failed to import sessions.json:', (e as Error).message);
    }
  }
}

export class SqliteAuthStore {
  static isEnabled(): boolean {
    const env = process.env.USE_SQLITE;
    if (env === '1') return true;
    if (env === '0') return false;
    return runtimeSupportsSqlite();
  }

  /** Async initialization; must be awaited before accessing `.db`. */
  static async init(): Promise<void> {
    if (this.isEnabled()) {
      await initDb();
    }
  }

  /** Synchronous accessor — only valid after `await init()` succeeds. */
  static get db(): any {
    if (!_db) {
      throw new Error('SqliteAuthStore not initialized. Await SqliteAuthStore.init() first.');
    }
    return _db;
  }
}

/** Close the SQLite handle on shutdown (no-op if never opened). */
export function closeSqliteStore(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      // ignore
    }
    _db = null;
  }
}
