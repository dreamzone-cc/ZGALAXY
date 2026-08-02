export type DNSProviderType = 'CLOUDFLARE' | 'MANUAL';

export interface DNSZone {
  id: string;
  name: string;
  status?: string;
}

export interface DNSRecord {
  id: string;
  zoneId?: string;
  name: string;
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT';
  content: string;
  ttl?: number;
  proxied?: boolean;
}

export interface CloudflareConfig {
  enabled: boolean;
  mode: 'AUTOMATIC' | 'MANUAL';
  apiToken: string;
  zoneId?: string;
  zoneName: string; // e.g. "mycompany.com"
  recordId?: string;
  recordName: string; // e.g. "planet" or "planet.mycompany.com"
  recordType: 'A' | 'AAAA';
  proxied: boolean;
  lastSyncedIp?: string;
  lastSyncedAt?: string;
  autoRebuildPlanet: boolean;
}

export interface CloudflareSyncLog {
  id: string;
  timestamp: string;
  status: 'SUCCESS' | 'ERROR' | 'NO_CHANGE';
  ipAddress: string;
  domain: string;
  message: string;
}

export interface IDNSProvider {
  name: string;
  verifyToken(token: string): Promise<boolean>;
  getZones(token: string): Promise<DNSZone[]>;
  getRecords(token: string, zoneId: string): Promise<DNSRecord[]>;
  updateRecord(
    token: string,
    zoneId: string,
    recordId: string,
    name: string,
    type: 'A' | 'AAAA',
    content: string,
    proxied?: boolean
  ): Promise<DNSRecord>;
  createRecord(
    token: string,
    zoneId: string,
    name: string,
    type: 'A' | 'AAAA',
    content: string,
    proxied?: boolean
  ): Promise<DNSRecord>;
}
