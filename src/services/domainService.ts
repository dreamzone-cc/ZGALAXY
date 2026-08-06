import dns from 'dns/promises';
import path from 'path';
import { config } from '../engine/config';
import { FileManager } from './fileManager';

export interface DomainRecord {
  domain: string;
  boundTo: 'PLANET' | 'MOON' | 'NONE';
  resolvedIp4: string[];
  resolvedIp6: string[];
  isResolvable: boolean;
  lastChecked: string;
}

export class DomainService {
  private static getStorePath(): string {
    return path.join(config.configPath, 'domains.json');
  }

  public static async getDomains(): Promise<DomainRecord[]> {
    const storePath = this.getStorePath();
    if (await FileManager.fileExists(storePath)) {
      return await FileManager.readJson<DomainRecord[]>(storePath);
    }
    return [];
  }

  public static async verifyDomain(domainName: string): Promise<DomainRecord> {
    const cleanDomain = domainName.trim().toLowerCase();
    let resolvedIp4: string[] = [];
    let resolvedIp6: string[] = [];
    let isResolvable = false;

    try {
      resolvedIp4 = await dns.resolve4(cleanDomain);
      isResolvable = true;
    } catch {
      resolvedIp4 = [];
    }

    try {
      resolvedIp6 = await dns.resolve6(cleanDomain);
      isResolvable = true;
    } catch {
      resolvedIp6 = [];
    }

    return {
      domain: cleanDomain,
      boundTo: 'NONE',
      resolvedIp4,
      resolvedIp6,
      isResolvable,
      lastChecked: new Date().toISOString(),
    };
  }

  public static async bindDomain(domainName: string, target: 'PLANET' | 'MOON'): Promise<DomainRecord> {
    const record = await this.verifyDomain(domainName);
    record.boundTo = target;

    const domains = await this.getDomains();
    const existingIndex = domains.findIndex((d) => d.domain === record.domain);
    if (existingIndex >= 0) {
      domains[existingIndex] = record;
    } else {
      domains.push(record);
    }

    await FileManager.writeJson(this.getStorePath(), domains);
    return record;
  }
}
