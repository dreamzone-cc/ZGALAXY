import crypto from 'crypto';
import path from 'path';
import { config } from '../engine/config';
import { FileManager } from './fileManager';
import { SqliteAuthStore } from './sqliteStore';

export type UserRole = 'ADMIN' | 'OPERATOR' | 'READ_ONLY';

const VALID_ROLES: UserRole[] = ['ADMIN', 'OPERATOR', 'READ_ONLY'];
const PBKDF2_ITERATIONS = 210000; // OWASP-recommended for PBKDF2-SHA512
const LEGACY_ITERATIONS = 1000; // previous default, kept for migrating existing hashes
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface UserRecord {
  username: string;
  passwordHash: string;
  salt: string;
  role: UserRole;
  createdAt: string;
  lastLoginAt?: string;
}

export interface UserSession {
  token: string;
  username: string;
  role: UserRole;
  createdAt: string;
}

export class UserService {
  // In-memory session cache: removes the per-request disk/DB read from the hot
  // path (the single biggest management-plane latency item). Explicitly
  // invalidated on revoke/logout/delete within this process, so correctness is
  // preserved for the single-instance architecture this project uses.
  private static readonly SESSION_CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly SESSION_CACHE_MAX = 5000;
  private static sessionCache = new Map<string, { session: UserSession; expiresAt: number }>();

  private static cacheGet(token: string): UserSession | null {
    const entry = this.sessionCache.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.sessionCache.delete(token);
      return null;
    }
    return entry.session;
  }

  private static cacheSet(token: string, session: UserSession): void {
    if (this.sessionCache.size >= this.SESSION_CACHE_MAX) {
      const now = Date.now();
      for (const [k, v] of this.sessionCache) {
        if (now > v.expiresAt) this.sessionCache.delete(k);
      }
      if (this.sessionCache.size >= this.SESSION_CACHE_MAX) {
        this.sessionCache.clear();
      }
    }
    this.sessionCache.set(token, { session, expiresAt: Date.now() + this.SESSION_CACHE_TTL_MS });
  }

  private static cacheDel(token: string): void {
    this.sessionCache.delete(token);
  }

  private static cacheDelUser(username: string): void {
    const lower = username.toLowerCase();
    for (const [k, v] of this.sessionCache) {
      if (v.session.username.toLowerCase() === lower) this.sessionCache.delete(k);
    }
  }

  private static get useSqlite(): boolean {
    return SqliteAuthStore.isEnabled();
  }

  private static getUsersFile(): string {
    return path.join(config.configPath, 'users.json');
  }

  private static getSessionsFile(): string {
    return path.join(config.configPath, 'sessions.json');
  }

  private static hashPassword(password: string, salt: string, iterations: number): Promise<string> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(password, salt, iterations, PBKDF2_KEYLEN, PBKDF2_DIGEST, (err, derivedKey) => {
        if (err) {
          reject(err);
        } else {
          resolve(derivedKey.toString('hex'));
        }
      });
    });
  }

  private static roleIsValid(role: string): role is UserRole {
    return VALID_ROLES.includes(role as UserRole);
  }

  private static async pruneExpiredSessions(sessions: UserSession[]): Promise<UserSession[]> {
    const now = Date.now();
    const active = sessions.filter((s) => now - new Date(s.createdAt).getTime() < SESSION_TTL_MS);
    if (active.length !== sessions.length) {
      await FileManager.writeJson(this.getSessionsFile(), active);
    }
    return active;
  }

  public static async getUsers(): Promise<UserRecord[]> {
    if (this.useSqlite) {
      await SqliteAuthStore.init();
      const rows = SqliteAuthStore.db.prepare('SELECT * FROM users').all() as any[];
      return rows.map((r) => ({
        username: r.username,
        passwordHash: r.password_hash,
        salt: r.salt,
        role: r.role,
        createdAt: r.created_at,
        lastLoginAt: r.last_login_at || undefined,
      }));
    }

    const filePath = this.getUsersFile();
    if (await FileManager.fileExists(filePath)) {
      return await FileManager.readJson<UserRecord[]>(filePath);
    }
    // Initialize default admin user if file doesn't exist
    const defaultSalt = crypto.randomBytes(16).toString('hex');
    const defaultAdmin: UserRecord = {
      username: 'admin',
      passwordHash: await this.hashPassword('admin', defaultSalt, PBKDF2_ITERATIONS),
      salt: defaultSalt,
      role: 'ADMIN',
      createdAt: new Date().toISOString(),
    };
    await FileManager.writeJson(filePath, [defaultAdmin]);
    return [defaultAdmin];
  }

  public static async getSessions(): Promise<UserSession[]> {
    if (this.useSqlite) {
      await SqliteAuthStore.init();
      const rows = SqliteAuthStore.db.prepare('SELECT * FROM sessions').all() as any[];
      return rows.map((r) => ({
        token: r.token,
        username: r.username,
        role: r.role,
        createdAt: r.created_at,
      }));
    }

    const filePath = this.getSessionsFile();
    if (await FileManager.fileExists(filePath)) {
      return await FileManager.readJson<UserSession[]>(filePath);
    }
    return [];
  }

  public static async authenticate(username: string, password: string): Promise<UserSession> {
    const users = await this.getUsers();
    const cleanName = username.trim();
    const user = users.find((u) => u.username.toLowerCase() === cleanName.toLowerCase());

    if (!user) {
      // Dummy PBKDF2 pass so unknown usernames cost the same as known ones
      // (mitigates user-enumeration via response timing).
      const dummySalt = crypto.randomBytes(16).toString('hex');
      await this.hashPassword(password, dummySalt, PBKDF2_ITERATIONS);
      throw new Error('Invalid username or password.');
    }

    const testHash = await this.hashPassword(password, user.salt, PBKDF2_ITERATIONS);
    if (testHash !== user.passwordHash) {
      // Legacy hash fallback (created with the previous 1000-iteration setting)
      const legacyHash = await this.hashPassword(password, user.salt, LEGACY_ITERATIONS);
      if (legacyHash !== user.passwordHash) {
        throw new Error('Invalid username or password.');
      }
      // Upgrade a legacy (weak-cost) hash to the current 210k cost on success.
      user.passwordHash = await this.hashPassword(password, user.salt, PBKDF2_ITERATIONS);
    }

    // Update last login
    user.lastLoginAt = new Date().toISOString();
    if (this.useSqlite) {
      await SqliteAuthStore.init();
      SqliteAuthStore.db
        .prepare('UPDATE users SET last_login_at = ? WHERE username = ?')
        .run(user.lastLoginAt, user.username);
    } else {
      await FileManager.writeJson(this.getUsersFile(), users);
    }

    // Create session token
    const token = crypto.randomBytes(32).toString('hex');
    const session: UserSession = {
      token,
      username: user.username,
      role: user.role,
      createdAt: new Date().toISOString(),
    };

    if (this.useSqlite) {
      await SqliteAuthStore.init();
      SqliteAuthStore.db
        .prepare('INSERT INTO sessions (token, username, role, created_at) VALUES (?, ?, ?, ?)')
        .run(session.token, session.username, session.role, session.createdAt);
    } else {
      const sessions = await this.getSessions();
      sessions.push(session);
      await FileManager.writeJson(this.getSessionsFile(), sessions);
    }

    return session;
  }

  public static async validateToken(token: string): Promise<UserSession | null> {
    // Hot path: serve from the in-memory cache when possible (no disk/DB I/O).
    const cached = this.cacheGet(token);
    if (cached) return cached;

    let session: UserSession | null = null;
    if (this.useSqlite) {
      await SqliteAuthStore.init();
      const row = SqliteAuthStore.db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as any;
      if (row) {
        if (Date.now() - new Date(row.created_at).getTime() >= SESSION_TTL_MS) {
          SqliteAuthStore.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
        } else {
          session = { token: row.token, username: row.username, role: row.role, createdAt: row.created_at };
        }
      }
    } else {
      const sessions = await this.pruneExpiredSessions(await this.getSessions());
      const found = sessions.find((s) => s.token === token) || null;
      if (found) {
        if (Date.now() - new Date(found.createdAt).getTime() >= SESSION_TTL_MS) {
          await this.revokeSession(token);
        } else {
          session = found;
        }
      }
    }

    if (session) this.cacheSet(token, session);
    return session;
  }

  public static async revokeSession(token: string): Promise<boolean> {
    this.cacheDel(token);
    if (this.useSqlite) {
      await SqliteAuthStore.init();
      const result = SqliteAuthStore.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return result.changes > 0;
    }

    const sessions = await this.getSessions();
    const filtered = sessions.filter((s) => s.token !== token);
    if (filtered.length !== sessions.length) {
      await FileManager.writeJson(this.getSessionsFile(), filtered);
      return true;
    }
    return false;
  }

  /** Delete expired sessions from the store and cache (called periodically). */
  public static async sweepExpiredSessions(): Promise<number> {
    const now = Date.now();
    for (const [k, v] of this.sessionCache) {
      if (now > v.expiresAt) this.sessionCache.delete(k);
    }
    const cutoff = new Date(now - SESSION_TTL_MS).toISOString();
    if (this.useSqlite) {
      await SqliteAuthStore.init();
      const result = SqliteAuthStore.db.prepare('DELETE FROM sessions WHERE created_at < ?').run(cutoff);
      return result.changes;
    }
    const sessions = await this.getSessions();
    const active = sessions.filter((s) => new Date(s.createdAt).getTime() >= now - SESSION_TTL_MS);
    if (active.length !== sessions.length) {
      await FileManager.writeJson(this.getSessionsFile(), active);
    }
    return sessions.length - active.length;
  }

  public static async createUser(username: string, password: string, role: UserRole): Promise<UserRecord> {
    if (!this.roleIsValid(role)) {
      throw new Error(`Invalid role '${role}'. Allowed roles: ${VALID_ROLES.join(', ')}.`);
    }

    if (!password || password.length < 8 || password.length > 128) {
      throw new Error('Password must be between 8 and 128 characters long.');
    }

    const cleanName = username.trim();
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(cleanName)) {
      throw new Error('Username must be 1-64 characters using letters, digits, dot, dash or underscore.');
    }

    if (this.useSqlite) {
      await SqliteAuthStore.init();
      const exists = SqliteAuthStore.db
        .prepare('SELECT username FROM users WHERE lower(username) = lower(?)')
        .get(cleanName);
      if (exists) {
        throw new Error(`User with username '${cleanName}' already exists.`);
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = await this.hashPassword(password, salt, PBKDF2_ITERATIONS);
      const createdAt = new Date().toISOString();
      SqliteAuthStore.db
        .prepare('INSERT INTO users (username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(cleanName, passwordHash, salt, role, createdAt);
      return { username: cleanName, passwordHash, salt, role, createdAt };
    }

    const users = await this.getUsers();

    if (users.some((u) => u.username.toLowerCase() === cleanName.toLowerCase())) {
      throw new Error(`User with username '${cleanName}' already exists.`);
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const newUser: UserRecord = {
      username: cleanName,
      passwordHash: await this.hashPassword(password, salt, PBKDF2_ITERATIONS),
      salt,
      role,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    await FileManager.writeJson(this.getUsersFile(), users);
    return newUser;
  }

  public static async deleteUser(username: string): Promise<boolean> {
    const cleanName = username.trim();
    if (cleanName.toLowerCase() === 'admin') {
      throw new Error('The master admin account cannot be deleted.');
    }
    this.cacheDelUser(cleanName);

    if (this.useSqlite) {
      await SqliteAuthStore.init();
      const count = SqliteAuthStore.db.prepare('SELECT COUNT(*) AS c FROM users').get() as any;
      if (count.c <= 1) {
        throw new Error('Cannot delete the last remaining user account.');
      }
      const result = SqliteAuthStore.db.prepare('DELETE FROM users WHERE lower(username) = lower(?)').run(cleanName);
      if (result.changes === 0) {
        throw new Error(`User '${username}' not found.`);
      }
      return true;
    }

    let users = await this.getUsers();
    if (users.length <= 1) {
      throw new Error('Cannot delete the last remaining user account.');
    }

    const initialLength = users.length;
    users = users.filter((u) => u.username.toLowerCase() !== cleanName.toLowerCase());

    if (users.length === initialLength) {
      throw new Error(`User '${username}' not found.`);
    }

    await FileManager.writeJson(this.getUsersFile(), users);

    // Revoke the deleted user's sessions so their token dies immediately
    // (the SQLite path already cascades via the foreign key).
    const sessions = await this.getSessions();
    const filtered = sessions.filter((s) => s.username.toLowerCase() !== cleanName.toLowerCase());
    if (filtered.length !== sessions.length) {
      await FileManager.writeJson(this.getSessionsFile(), filtered);
    }
    return true;
  }
}
