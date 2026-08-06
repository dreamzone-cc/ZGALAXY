import { IDNSProvider, DNSZone, DNSRecord } from '../types';

const CF_TIMEOUT_MS = 10_000;
const CF_MAX_RETRIES = 1;

export class CloudflareProvider implements IDNSProvider {
  public name = 'Cloudflare';
  private baseUrl = 'https://api.cloudflare.com/client/v4';

  private getHeaders(token: string): Record<string, string> {
    return {
      'Authorization': `Bearer ${token.trim()}`,
      'Content-Type': 'application/json',
    };
  }

  /** fetch with a bounded timeout and one retry on transient 429/5xx. */
  private async cfFetch(url: string, init: RequestInit): Promise<Response> {
    const attempt = async (): Promise<Response> =>
      await fetch(url, { ...init, signal: AbortSignal.timeout(CF_TIMEOUT_MS) });
    let res = await attempt();
    if ((res.status === 429 || res.status >= 500) && CF_MAX_RETRIES > 0) {
      await new Promise((r) => setTimeout(r, 500));
      res = await attempt();
    }
    return res;
  }

  public async verifyToken(token: string): Promise<boolean> {
    try {
      const cleanToken = token.trim();
      // Try standard user token verification first
      const res = await this.cfFetch(`${this.baseUrl}/user/tokens/verify`, {
        method: 'GET',
        headers: this.getHeaders(cleanToken),
      });
      const data = (await res.json()) as any;
      if (res.ok && data.success === true && data.result?.status === 'active') {
        return true;
      }

      // Fallback: Test token permissions directly by querying available zones
      const zonesRes = await this.cfFetch(`${this.baseUrl}/zones?per_page=1`, {
        method: 'GET',
        headers: this.getHeaders(cleanToken),
      });
      const zonesData = (await zonesRes.json()) as any;
      return zonesRes.ok && zonesData.success === true;
    } catch (err: any) {
      console.error('[CLOUDFLARE API] Token verification error:', err.message);
      return false;
    }
  }

  public async getZones(token: string): Promise<DNSZone[]> {
    const res = await this.cfFetch(`${this.baseUrl}/zones?per_page=50&status=active`, {
      method: 'GET',
      headers: this.getHeaders(token),
    });

    const data = (await res.json()) as any;
    if (!res.ok || !data.success) {
      const errMsg = data.errors?.[0]?.message || 'Failed to fetch zones from Cloudflare API.';
      throw new Error(`Cloudflare API Error: ${errMsg}`);
    }

    return (data.result || []).map((z: any) => ({
      id: z.id,
      name: z.name,
      status: z.status,
    }));
  }

  public async getRecords(token: string, zoneId: string): Promise<DNSRecord[]> {
    const res = await this.cfFetch(`${this.baseUrl}/zones/${zoneId}/dns_records?per_page=100`, {
      method: 'GET',
      headers: this.getHeaders(token),
    });

    const data = (await res.json()) as any;
    if (!res.ok || !data.success) {
      const errMsg = data.errors?.[0]?.message || 'Failed to fetch DNS records from Cloudflare API.';
      throw new Error(`Cloudflare API Error: ${errMsg}`);
    }

    return (data.result || []).map((r: any) => ({
      id: r.id,
      zoneId: r.zone_id,
      name: r.name,
      type: r.type,
      content: r.content,
      ttl: r.ttl,
      proxied: r.proxied,
    }));
  }

  public async updateRecord(
    token: string,
    zoneId: string,
    recordId: string,
    name: string,
    type: 'A' | 'AAAA',
    content: string,
    proxied: boolean = false
  ): Promise<DNSRecord> {
    const payload = {
      type,
      name,
      content,
      ttl: 1, // Auto TTL
      proxied,
    };

    const res = await this.cfFetch(`${this.baseUrl}/zones/${zoneId}/dns_records/${recordId}`, {
      method: 'PUT',
      headers: this.getHeaders(token),
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as any;
    if (!res.ok || !data.success) {
      const errMsg = data.errors?.[0]?.message || 'Failed to update DNS record on Cloudflare.';
      throw new Error(`Cloudflare API Error: ${errMsg}`);
    }

    const r = data.result;
    return {
      id: r.id,
      zoneId: r.zone_id,
      name: r.name,
      type: r.type,
      content: r.content,
      ttl: r.ttl,
      proxied: r.proxied,
    };
  }

  public async createRecord(
    token: string,
    zoneId: string,
    name: string,
    type: 'A' | 'AAAA',
    content: string,
    proxied: boolean = false
  ): Promise<DNSRecord> {
    const payload = {
      type,
      name,
      content,
      ttl: 1, // Auto TTL
      proxied,
    };

    const res = await this.cfFetch(`${this.baseUrl}/zones/${zoneId}/dns_records`, {
      method: 'POST',
      headers: this.getHeaders(token),
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as any;
    if (!res.ok || !data.success) {
      const errMsg = data.errors?.[0]?.message || 'Failed to create DNS record on Cloudflare.';
      throw new Error(`Cloudflare API Error: ${errMsg}`);
    }

    const r = data.result;
    return {
      id: r.id,
      zoneId: r.zone_id,
      name: r.name,
      type: r.type,
      content: r.content,
      ttl: r.ttl,
      proxied: r.proxied,
    };
  }
}
