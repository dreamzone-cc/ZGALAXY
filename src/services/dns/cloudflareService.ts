import path from 'path';
import crypto from 'crypto';
import { config } from '../../engine/config';
import { FileManager } from '../fileManager';
import { NetworkService } from '../networkService';
import { PlanetService } from '../planetService';
import { CloudflareProvider } from './providers/cloudflareProvider';
import { CloudflareConfig, CloudflareSyncLog, DNSZone, DNSRecord } from './types';

export class CloudflareService {
  private static provider = new CloudflareProvider();

  private static getConfigPath(): string {
    return path.join(config.configPath, 'cloudflare_config.json');
  }

  private static getLogsPath(): string {
    return path.join(config.configPath, 'cloudflare_logs.json');
  }

  public static async getConfig(): Promise<CloudflareConfig> {
    const filePath = this.getConfigPath();
    if (await FileManager.fileExists(filePath)) {
      return await FileManager.readJson<CloudflareConfig>(filePath);
    }
    const defaultConfig: CloudflareConfig = {
      enabled: false,
      mode: 'MANUAL',
      apiToken: '',
      zoneName: '',
      recordName: '',
      recordType: 'A',
      proxied: false,
      autoRebuildPlanet: true,
    };
    await FileManager.writeJson(filePath, defaultConfig);
    return defaultConfig;
  }

  public static async saveConfig(updated: Partial<CloudflareConfig>): Promise<CloudflareConfig> {
    const current = await this.getConfig();
    const merged: CloudflareConfig = { ...current, ...updated };
    await FileManager.writeJson(this.getConfigPath(), merged);
    return merged;
  }

  public static async getLogs(): Promise<CloudflareSyncLog[]> {
    const filePath = this.getLogsPath();
    if (await FileManager.fileExists(filePath)) {
      return await FileManager.readJson<CloudflareSyncLog[]>(filePath);
    }
    return [];
  }

  public static async clearLogs(): Promise<void> {
    await FileManager.writeJson(this.getLogsPath(), []);
  }

  public static async addLog(
    status: 'SUCCESS' | 'ERROR' | 'NO_CHANGE',
    ipAddress: string,
    domain: string,
    message: string
  ): Promise<void> {
    const logs = await this.getLogs();
    const newLog: CloudflareSyncLog = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      status,
      ipAddress,
      domain,
      message,
    };
    const updated = [newLog, ...logs.slice(0, 99)]; // Keep last 100 logs
    await FileManager.writeJson(this.getLogsPath(), updated);
  }

  public static async verifyToken(token: string): Promise<boolean> {
    if (!token || !token.trim()) return false;
    return await this.provider.verifyToken(token.trim());
  }

  public static async getZones(token?: string): Promise<DNSZone[]> {
    const cfg = await this.getConfig();
    const activeToken = token || cfg.apiToken;
    if (!activeToken) throw new Error('Cloudflare API Token is missing.');
    return await this.provider.getZones(activeToken);
  }

  public static async getRecords(zoneId: string, token?: string): Promise<DNSRecord[]> {
    const cfg = await this.getConfig();
    const activeToken = token || cfg.apiToken;
    if (!activeToken) throw new Error('Cloudflare API Token is missing.');
    return await this.provider.getRecords(activeToken, zoneId);
  }

  public static async syncDNS(force: boolean = false): Promise<{ synced: boolean; message: string; ip: string }> {
    const cfg = await this.getConfig();
    if (!cfg.enabled && !force) {
      return { synced: false, message: 'Cloudflare auto-sync is disabled.', ip: '' };
    }

    if (!cfg.apiToken) {
      const msg = 'Cloudflare API Token is not configured.';
      await this.addLog('ERROR', '', cfg.recordName || cfg.zoneName || 'N/A', msg);
      return { synced: false, message: msg, ip: '' };
    }

    // 1. Detect public IP
    const addrs = await NetworkService.getNetworkAddresses();
    const currentPublicIp = addrs.external.ip4 || addrs.internal.ip4[0] || '';

    if (!currentPublicIp) {
      const msg = 'Unable to detect server public IP address.';
      await this.addLog('ERROR', '', cfg.recordName, msg);
      return { synced: false, message: msg, ip: '' };
    }

    const fullDomainName = cfg.recordName
      ? cfg.recordName.includes('.')
        ? cfg.recordName
        : `${cfg.recordName}.${cfg.zoneName}`
      : cfg.zoneName;

    // Check if IP hasn't changed
    if (!force && cfg.lastSyncedIp === currentPublicIp) {
      return { synced: false, message: `IP unchanged (${currentPublicIp}). No sync required.`, ip: currentPublicIp };
    }

    try {
      let targetZoneId = cfg.zoneId;
      let targetRecordId = cfg.recordId;

      // In Automatic or Fallback Mode, attempt to resolve zoneId & recordId if missing
      if (!targetZoneId && cfg.zoneName) {
        const zones = await this.provider.getZones(cfg.apiToken);
        const matchedZone = zones.find((z) => z.name.toLowerCase() === cfg.zoneName.toLowerCase().trim());
        if (matchedZone) {
          targetZoneId = matchedZone.id;
        } else {
          throw new Error(`Zone '${cfg.zoneName}' not found in Cloudflare account.`);
        }
      }

      if (targetZoneId && !targetRecordId && cfg.recordName) {
        const records = await this.provider.getRecords(cfg.apiToken, targetZoneId);
        const matchedRecord = records.find((r) => r.name.toLowerCase() === fullDomainName.toLowerCase());
        if (matchedRecord) {
          targetRecordId = matchedRecord.id;
        }
      }

      if (!targetZoneId) {
        throw new Error('Zone ID or Zone Name must be provided.');
      }

      // Update existing record or create new record
      if (targetRecordId) {
        await this.provider.updateRecord(
          cfg.apiToken,
          targetZoneId,
          targetRecordId,
          fullDomainName,
          cfg.recordType || 'A',
          currentPublicIp,
          cfg.proxied
        );
      } else {
        const created = await this.provider.createRecord(
          cfg.apiToken,
          targetZoneId,
          fullDomainName,
          cfg.recordType || 'A',
          currentPublicIp,
          cfg.proxied
        );
        targetRecordId = created.id;
      }

      // Update stored config state
      await this.saveConfig({
        zoneId: targetZoneId,
        recordId: targetRecordId,
        lastSyncedIp: currentPublicIp,
        lastSyncedAt: new Date().toISOString(),
      });

      const successMsg = `Successfully updated Cloudflare DNS record '${fullDomainName}' to IP ${currentPublicIp}.`;
      await this.addLog('SUCCESS', currentPublicIp, fullDomainName, successMsg);

      // Auto-rebuild Planet if configured
      if (cfg.autoRebuildPlanet) {
        try {
          await PlanetService.buildPlanet({
            domain: fullDomainName,
            ip4: currentPublicIp,
          });
        } catch (planetErr: any) {
          console.error('[CLOUDFLARE PLANET AUTO-REBUILD ERROR]', planetErr.message);
        }
      }

      return { synced: true, message: successMsg, ip: currentPublicIp };
    } catch (err: any) {
      const errMsg = err.message || 'Failed to sync with Cloudflare API.';
      await this.addLog('ERROR', currentPublicIp, fullDomainName, errMsg);
      throw new Error(errMsg);
    }
  }
}
