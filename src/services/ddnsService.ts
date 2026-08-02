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

  public static async updateConfig(newConfig: Partial<DDNSConfig>): Promise<DDNSConfig> {
    const current = await this.getConfig();
    const updated = { ...current, ...newConfig };
    await FileManager.writeJson(this.getConfigFile(), updated);
    return updated;
  }

  public static async checkAndSyncDDNS(): Promise<{
    changed: boolean;
    domain: string;
    resolvedIp4: string;
    resolvedIp6: string;
    message: string;
  }> {
    const ddnsConfig = await this.getConfig();
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

    let currentIp4 = '';
    let currentIp6 = '';

    try {
      const ips = await dns.resolve4(targetDomain);
      if (ips.length > 0) currentIp4 = ips[0];
    } catch {
      currentIp4 = '';
    }

    try {
      const ips6 = await dns.resolve6(targetDomain);
      if (ips6.length > 0) currentIp6 = ips6[0];
    } catch {
      currentIp6 = '';
    }

    const hasChanged = Boolean(
      (currentIp4 && currentIp4 !== ddnsConfig.lastResolvedIp4) ||
      (currentIp6 && currentIp6 !== ddnsConfig.lastResolvedIp6)
    );

    const now = new Date().toISOString();
    ddnsConfig.lastCheckedAt = now;
    ddnsConfig.domain = targetDomain;

    if (hasChanged) {
      ddnsConfig.lastResolvedIp4 = currentIp4;
      ddnsConfig.lastResolvedIp6 = currentIp6;
      ddnsConfig.lastChangedAt = now;

      if (ddnsConfig.autoRebuildOnChange) {
        await PlanetService.buildPlanet({
          domain: targetDomain,
          ip4: currentIp4,
          ip6: currentIp6,
          port: config.ztPort,
        });
      }
    }

    await this.updateConfig(ddnsConfig);

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
