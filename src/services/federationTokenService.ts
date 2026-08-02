import path from 'path';
import crypto from 'crypto';
import { config } from '../engine/config';
import { FileManager } from './fileManager';

export type SyncMode = 'FEDERATION_INHERITED' | 'DIRECT_ISOLATED';
export type FederationPermission = 'READ' | 'WRITE' | 'PLANET_SYNC' | 'MOON_SYNC';

export interface FederationToken {
  tokenId: string;
  tokenSecret: string;
  name: string;
  creator: string;
  syncMode: SyncMode;
  permissions: FederationPermission[];
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  createdAt: string;
}

export interface CreateTokenInput {
  name: string;
  syncMode?: SyncMode;
  permissions?: FederationPermission[];
  maxUses?: number;
  expiresInDays?: number;
  creator?: string;
}

export class FederationTokenService {
  private static get tokenConfigPath(): string {
    return path.join(config.configPath, 'federation_tokens.json');
  }

  private static async loadTokensStore(): Promise<{ tokens: FederationToken[] }> {
    if (await FileManager.fileExists(this.tokenConfigPath)) {
      try {
        const store = await FileManager.readJson(this.tokenConfigPath);
        if (store && Array.isArray(store.tokens)) {
          return store;
        }
      } catch {
        // Fallback to empty store initialization
      }
    }
    const defaultStore = { tokens: [] };
    await FileManager.writeJson(this.tokenConfigPath, defaultStore);
    return defaultStore;
  }

  private static async saveTokensStore(store: { tokens: FederationToken[] }): Promise<void> {
    await FileManager.writeJson(this.tokenConfigPath, store);
  }

  public static async listTokens(): Promise<FederationToken[]> {
    const store = await this.loadTokensStore();
    const now = new Date();

    // Auto-update status for expired tokens
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

  public static async createToken(input: CreateTokenInput): Promise<FederationToken> {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error('Token name is required.');
    }

    const store = await this.loadTokensStore();

    const tokenId = `ftok_${crypto.randomBytes(6).toString('hex')}`;
    const tokenSecret = `zgt_fed_sec_${crypto.randomBytes(18).toString('hex')}`;

    const days = input.expiresInDays && input.expiresInDays > 0 ? input.expiresInDays : 365;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const newToken: FederationToken = {
      tokenId,
      tokenSecret,
      name: input.name.trim(),
      creator: input.creator || 'admin',
      syncMode: input.syncMode || 'FEDERATION_INHERITED',
      permissions: input.permissions || ['READ', 'WRITE', 'PLANET_SYNC', 'MOON_SYNC'],
      maxUses: input.maxUses !== undefined ? input.maxUses : 100,
      usedCount: 0,
      expiresAt,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };

    store.tokens.push(newToken);
    await this.saveTokensStore(store);

    return newToken;
  }

  public static async validateToken(tokenSecret: string): Promise<{ valid: boolean; token?: FederationToken; error?: string }> {
    if (!tokenSecret || tokenSecret.trim().length === 0) {
      return { valid: false, error: 'Token secret is required.' };
    }

    const store = await this.loadTokensStore();
    const token = store.tokens.find((t) => t.tokenSecret === tokenSecret.trim());

    if (!token) {
      return { valid: false, error: 'Invalid Federation Token secret.' };
    }

    if (token.status === 'REVOKED') {
      return { valid: false, error: 'Federation Token has been permanently revoked.' };
    }

    if (new Date(token.expiresAt) < new Date()) {
      token.status = 'EXPIRED';
      await this.saveTokensStore(store);
      return { valid: false, error: 'Federation Token has expired.' };
    }

    if (token.maxUses > 0 && token.usedCount >= token.maxUses) {
      return { valid: false, error: 'Federation Token has reached maximum allowed uses limit.' };
    }

    // Increment usage count
    token.usedCount += 1;
    await this.saveTokensStore(store);

    return { valid: true, token };
  }

  public static async revokeToken(tokenId: string): Promise<FederationToken> {
    const store = await this.loadTokensStore();
    const token = store.tokens.find((t) => t.tokenId === tokenId);

    if (!token) {
      throw new Error(`Federation Token [${tokenId}] not found.`);
    }

    token.status = 'REVOKED';
    await this.saveTokensStore(store);
    return token;
  }

  public static async renewToken(tokenId: string, extensionDays = 30): Promise<FederationToken> {
    const store = await this.loadTokensStore();
    const token = store.tokens.find((t) => t.tokenId === tokenId);

    if (!token) {
      throw new Error(`Federation Token [${tokenId}] not found.`);
    }

    const currentExpiry = new Date(token.expiresAt) > new Date() ? new Date(token.expiresAt) : new Date();
    token.expiresAt = new Date(currentExpiry.getTime() + extensionDays * 24 * 60 * 60 * 1000).toISOString();
    token.status = 'ACTIVE';
    
    await this.saveTokensStore(store);
    return token;
  }
}
