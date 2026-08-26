import path from 'path';
import crypto from 'crypto';
import { config } from '../engine/config';
import { FileManager } from './fileManager';

export type SyncTokenType = 'single' | 'group' | 'contract';

export interface SyncToken {
  tokenId: string;
  tokenSecret: string;
  name: string;
  creator: string;
  tokenType: SyncTokenType;
  maxDevices: number;
  registeredDevices: string[];
  scope: string[];
  expiresAt: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  createdAt: string;
}

export interface CreateSyncTokenInput {
  name: string;
  tokenType?: SyncTokenType;
  maxDevices?: number;
  scope?: string[];
  expiresInDays?: number;
  creator?: string;
}

export class SyncTokenService {
  private static get tokenConfigPath(): string {
    return path.join(config.configPath, 'sync_tokens.json');
  }

  private static async loadTokensStore(): Promise<{ tokens: SyncToken[] }> {
    if (await FileManager.fileExists(this.tokenConfigPath)) {
      try {
        const store = await FileManager.readJson(this.tokenConfigPath);
        if (store && Array.isArray(store.tokens)) {
          return store;
        }
      } catch {
        // Fallback to default
      }
    }
    const defaultStore = { tokens: [] };
    await FileManager.writeJson(this.tokenConfigPath, defaultStore);
    return defaultStore;
  }

  private static async saveTokensStore(store: { tokens: SyncToken[] }): Promise<void> {
    await FileManager.writeJson(this.tokenConfigPath, store);
  }

  public static async listTokens(): Promise<SyncToken[]> {
    const store = await this.loadTokensStore();
    const now = new Date();
    let updated = false;

    for (const token of store.tokens) {
      if (token.status === 'ACTIVE' && new Date(token.expiresAt) < now) {
        token.status = 'EXPIRED';
        updated = true;
      }
    }

    if (updated) {
      await this.saveTokensStore(store);
    }

    return store.tokens;
  }

  public static async createToken(input: CreateSyncTokenInput): Promise<SyncToken> {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error('Token name is required.');
    }

    const tokenType = input.tokenType || 'single';
    let maxDevices = 1;
    let days = 30;

    if (tokenType === 'single') {
      maxDevices = 1;
      days = input.expiresInDays && input.expiresInDays > 0 ? input.expiresInDays : 30;
    } else if (tokenType === 'group') {
      maxDevices = input.maxDevices !== undefined && input.maxDevices > 0 ? input.maxDevices : 5;
      days = input.expiresInDays && input.expiresInDays > 0 ? input.expiresInDays : 30;
    } else if (tokenType === 'contract') {
      // CONTRACT policy: Fixed 365-day (1-year) contractual term; overrides and ignores arbitrary duration overrides
      maxDevices = input.maxDevices !== undefined && input.maxDevices > 0 ? input.maxDevices : 50;
      days = 365;
    }

    const creator = (input.creator && input.creator.trim()) || 'admin';
    const store = await this.loadTokensStore();

    const tokenId = `zgt_${crypto.randomBytes(6).toString('hex')}`;
    const tokenSecret = `ZG-tok_${crypto.randomBytes(16).toString('hex')}`;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const newToken: SyncToken = {
      tokenId,
      tokenSecret,
      name: input.name.trim(),
      creator,
      tokenType,
      maxDevices,
      registeredDevices: [],
      scope: input.scope || ['planet:earth', 'moons:*'],
      expiresAt,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };

    store.tokens.push(newToken);
    await this.saveTokensStore(store);
    return newToken;
  }

  public static async validateAndRegisterDevice(
    tokenSecret: string,
    deviceFingerprint: string
  ): Promise<{ valid: boolean; token?: SyncToken; error?: string; statusCode?: number }> {
    if (!tokenSecret || !tokenSecret.trim()) {
      return { valid: false, error: 'Token is required.', statusCode: 401 };
    }

    const cleanSecret = tokenSecret.trim();
    const store = await this.loadTokensStore();
    const token = store.tokens.find((t) => t.tokenSecret === cleanSecret);

    if (!token) {
      return { valid: false, error: 'Invalid Token.', statusCode: 401 };
    }

    if (token.status === 'REVOKED') {
      return { valid: false, error: 'Token has been revoked.', statusCode: 403 };
    }

    if (new Date(token.expiresAt) < new Date()) {
      token.status = 'EXPIRED';
      await this.saveTokensStore(store);
      return { valid: false, error: 'Token has expired.', statusCode: 401 };
    }

    if (deviceFingerprint) {
      if (!token.registeredDevices.includes(deviceFingerprint)) {
        if (token.maxDevices > 0 && token.registeredDevices.length >= token.maxDevices) {
          return { valid: false, error: `Device limit exceeded (${token.maxDevices} max).`, statusCode: 403 };
        }
        token.registeredDevices.push(deviceFingerprint);
        await this.saveTokensStore(store);
      }
    }

    return { valid: true, token };
  }

  public static async revokeToken(tokenId: string): Promise<SyncToken> {
    const store = await this.loadTokensStore();
    const token = store.tokens.find((t) => t.tokenId === tokenId);
    if (!token) {
      throw new Error(`Token ${tokenId} not found.`);
    }
    token.status = 'REVOKED';
    await this.saveTokensStore(store);
    return token;
  }
}
