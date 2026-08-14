import dns from 'dns/promises';
import path from 'path';
import { config } from '../engine/config';
import { FileManager } from './fileManager';
import { PlanetService } from './planetService';

export interface DDNSConfig {
  enabled: boolean;
  domain: string;
  checkIntervalMinutes: number;
  autoRebuildOnChange: boolean;
  provider: 'DNS_POLLING' | 'DUCK_DNS' | 'CLOUDFLARE' | 'NO_IP' | 'CUSTOM_WEBHOOK';
  providerToken?: string;
  lastResolvedIp4: string;
  lastResolvedIp6: string;
  lastCheckedAt: string;
  lastChangedAt: string;
}

const VALID_PROVIDERS: DDNSConfig['provider'][] = ['DNS_POLLING', 'DUCK_DNS', 'CLOUDFLARE', 'NO_IP', 'CUSTOM_WEBHOOK'];
const CONFIG_KEYS: (keyof DDNSConfig)[] = [
  'enabled',
  'domain',
  'checkIntervalMinutes',
  'autoRebuildOnChange',
  'provider',
  'providerToken',
];

export class DDNSService {
  private static getConfigFile(): string {
    return path.join(config.configPath, 'ddns_config.json');
  }

  public static async getConfig(): Promise<DDNSConfig> {
    const filePath = this.getConfigFile();
    if (await FileManager.fileExists(filePath)) {
      return await FileManager.readJson<DDNSConfig>(filePath);
    }
    return {
      enabled: true,
      domain: '',
      checkIntervalMinutes: 5,
      autoRebuildOnChange: true,
      provider: 'DNS_POLLING',
      lastResolvedIp4: '',
      lastResolvedIp6: '',
      lastCheckedAt: new Date().toISOString(),
      lastChangedAt: new Date().toISOString(),
    };
  }

  /** Persist only the fields the caller may set (no mass assignment). */
  public static async updateConfig(newConfig: Partial<DDNSConfig>): Promise<DDNSConfig> {
    const current = await this.getConfig();
    for (const key of CONFIG_KEYS) {
      const value = (newConfig as any)[key];
      if (value === undefined) continue;
      if (key === 'enabled' || key === 'autoRebuildOnChange') {
        (current as any)[key] = Boolean(value);
      } else if (key === 'checkIntervalMinutes') {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 1 || n > 1440) {
          throw new Error('checkIntervalMinutes must be between 1 and 1440.');
        }
        (current as any)[key] = n;
      } else if (key === 'provider') {
        if (!VALID_PROVIDERS.includes(value)) {
          throw new Error(`Invalid provider '${value}'.`);
        }
        (current as any)[key] = value;
      } else if (key === 'domain') {
        const d = String(value).trim();
        if (d && d.length > 253) throw new Error('Domain name is too long.');
        (current as any)[key] = d;
      } else {
        (current as any)[key] = value;
      }
    }
    await FileManager.writeJson(this.getConfigFile(), current);
    return current;
  }

  /** Merge only the mutating tracking fields (avoids clobbering a concurrent POST /config). */
  private static async persistTrackingState(partial: Partial<DDNSConfig>): Promise<void> {
    const current = await this.getConfig();
    if (partial.lastResolvedIp4 !== undefined) current.lastResolvedIp4 = partial.lastResolvedIp4;
    if (partial.lastResolvedIp6 !== undefined) current.lastResolvedIp6 = partial.lastResolvedIp6;
    if (partial.lastCheckedAt !== undefined) current.lastCheckedAt = partial.lastCheckedAt;
    if (partial.lastChangedAt !== undefined) current.lastChangedAt = partial.lastChangedAt;
    if (partial.domain !== undefined) current.domain = partial.domain;
    await FileManager.writeJson(this.getConfigFile(), current);
  }

  public static async checkAndSyncDDNS(): Promise<{
    changed: boolean;
    domain: string;
    resolvedIp4: string;
    resolvedIp6: string;
    message: string;
  }> {
    const ddnsConfig = await this.getConfig();

    // Honor the enabled flag: a "disabled" DDNS must not probe or rebuild.
    if (!ddnsConfig.enabled) {
      return {
        changed: false,
        domain: ddnsConfig.domain,
        resolvedIp4: '',
        resolvedIp6: '',
        message: 'DDNS auto-sync is disabled.',
      };
    }

    const planetInfo = await PlanetService.getPlanetInfo();
    const targetDomain = ddnsConfig.domain || planetInfo.domain;

    if (!targetDomain) {
      return {
        changed: false,
        domain: '',
        resolvedIp4: '',
        resolvedIp6: '',
        message: 'No domain name bound to Planet. Configure a domain first.',
      };
    }

    let ips4: string[] = [];
    let ips6: string[] = [];
    let resolveOk4 = false;
    let resolveOk6 = false;

    try {
      const resolved = await dns.resolve4(targetDomain);
      if (resolved.length > 0) {
        ips4 = resolved.sort();
        resolveOk4 = true;
      }
    } catch {
      ips4 = [];
    }

    try {
      const resolved6 = await dns.resolve6(targetDomain);
      if (resolved6.length > 0) {
        ips6 = resolved6.sort();
        resolveOk6 = true;
      }
    } catch {
      ips6 = [];
    }

    const previous4 = ddnsConfig.lastResolvedIp4 || '';
    const previous6 = ddnsConfig.lastResolvedIp6 || '';

    // If previous IP is still in the valid resolved set, keep it to avoid churn from Round-Robin / multi-A DNS.
    const currentIp4 = resolveOk4 ? (ips4.includes(previous4) ? previous4 : ips4[0]) : '';
    const currentIp6 = resolveOk6 ? (ips6.includes(previous6) ? previous6 : ips6[0]) : '';

    const isPrivateIp = (ip: string) => {
      if (!ip) return false;
      const parts = ip.split('.').map(Number);
      if (parts.length === 4) {
        if (parts[0] === 10) return true;
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        if (parts[0] === 192 && parts[1] === 168) return true;
        if (parts[0] === 127) return true;
        if (parts[0] === 169 && parts[1] === 254) return true;
      }
      return false;
    };

    if (currentIp4 && isPrivateIp(currentIp4) && process.env.ALLOW_PRIVATE_CLUSTER !== '1') {
      return {
        changed: false,
        domain: targetDomain,
        resolvedIp4: currentIp4,
        resolvedIp6: currentIp6,
        message: `Resolved IP ${currentIp4} is a private IP. Set ALLOW_PRIVATE_CLUSTER=1 to allow private Planet endpoints.`,
      };
    }

    const hasChanged = resolveOk4 !== Boolean(previous4) || resolveOk6 !== Boolean(previous6) ||
      (resolveOk4 && previous4 !== currentIp4) || (resolveOk6 && previous6 !== currentIp6);

    const now = new Date().toISOString();

    if (hasChanged) {
      // Persist the new resolution + timestamp BEFORE the (slow) rebuild so a
      // failed rebuild does not trigger rediscovery every tick.
      await this.persistTrackingState({
        domain: targetDomain,
        lastResolvedIp4: currentIp4,
        lastResolvedIp6: currentIp6,
        lastChangedAt: now,
        lastCheckedAt: now,
      });

      if (ddnsConfig.autoRebuildOnChange && (resolveOk4 || resolveOk6)) {
        // Reuse the port the planet was actually built with, not the global default.
        const port = planetInfo.port || config.ztPort;
        await PlanetService.buildPlanet({
          domain: targetDomain,
          ip4: currentIp4,
          ip6: currentIp6,
          port,
        });
      }
    } else {
      await this.persistTrackingState({ domain: targetDomain, lastCheckedAt: now });
    }

    return {
      changed: hasChanged,
      domain: targetDomain,
      resolvedIp4: currentIp4,
      resolvedIp6: currentIp6,
      message: hasChanged
        ? `Dynamic IP changed! Planet stableEndpoints updated to ${targetDomain} (${currentIp4})`
        : `DNS resolution in sync for ${targetDomain} (${currentIp4 || 'N/A'})`,
    };
  }
}
