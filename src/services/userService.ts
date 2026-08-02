import crypto from 'crypto';
import path from 'path';
import { config } from '../engine/config';
import { FileManager } from './fileManager';

export type UserRole = 'ADMIN' | 'OPERATOR' | 'READ_ONLY';

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
  private static getUsersFile(): string {
    return path.join(config.configPath, 'users.json');
  }

  private static getSessionsFile(): string {
    return path.join(config.configPath, 'sessions.json');
  }

  private static hashPassword(password: string, salt: string): string {
    return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  }

  public static async getUsers(): Promise<UserRecord[]> {
    const filePath = this.getUsersFile();
    if (await FileManager.fileExists(filePath)) {
      return await FileManager.readJson<UserRecord[]>(filePath);
    }
    // Initialize default admin user if file doesn't exist
    const defaultSalt = crypto.randomBytes(16).toString('hex');
    const defaultAdmin: UserRecord = {
      username: 'admin',
      passwordHash: this.hashPassword('admin', defaultSalt),
      salt: defaultSalt,
      role: 'ADMIN',
      createdAt: new Date().toISOString(),
    };
    await FileManager.writeJson(filePath, [defaultAdmin]);
    return [defaultAdmin];
  }

  public static async getSessions(): Promise<UserSession[]> {
    const filePath = this.getSessionsFile();
    if (await FileManager.fileExists(filePath)) {
      return await FileManager.readJson<UserSession[]>(filePath);
    }
    return [];
  }

  public static async authenticate(username: string, password: string): Promise<UserSession> {
    const users = await this.getUsers();
    const user = users.find((u) => u.username.toLowerCase() === username.toLowerCase().trim());

    if (!user) {
      throw new Error('Invalid username or password.');
    }

    const testHash = this.hashPassword(password, user.salt);
    if (testHash !== user.passwordHash) {
      throw new Error('Invalid username or password.');
    }

    // Update last login
    user.lastLoginAt = new Date().toISOString();
    await FileManager.writeJson(this.getUsersFile(), users);

    // Create session token
    const token = crypto.randomBytes(32).toString('hex');
    const session: UserSession = {
      token,
      username: user.username,
      role: user.role,
      createdAt: new Date().toISOString(),
    };

    const sessions = await this.getSessions();
    sessions.push(session);
    await FileManager.writeJson(this.getSessionsFile(), sessions);

    return session;
  }

  public static async validateToken(token: string): Promise<UserSession | null> {
    const sessions = await this.getSessions();
    return sessions.find((s) => s.token === token) || null;
  }

  public static async createUser(username: string, password: string, role: UserRole): Promise<UserRecord> {
    const users = await this.getUsers();
    const cleanName = username.trim();

    if (users.some((u) => u.username.toLowerCase() === cleanName.toLowerCase())) {
      throw new Error(`User with username '${cleanName}' already exists.`);
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const newUser: UserRecord = {
      username: cleanName,
      passwordHash: this.hashPassword(password, salt),
      salt,
      role,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    await FileManager.writeJson(this.getUsersFile(), users);
    return newUser;
  }

  public static async deleteUser(username: string): Promise<boolean> {
    let users = await this.getUsers();
    if (users.length <= 1) {
      throw new Error('Cannot delete the last remaining user account.');
    }

    const initialLength = users.length;
    users = users.filter((u) => u.username.toLowerCase() !== username.toLowerCase().trim());

    if (users.length === initialLength) {
      throw new Error(`User '${username}' not found.`);
    }

    await FileManager.writeJson(this.getUsersFile(), users);
    return true;
  }
}
