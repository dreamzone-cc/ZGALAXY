import os from 'os';
import net from 'net';
import https from 'https';

export interface NetworkAddressesResult {
  internal: {
    ip4: string[];
    ip6: string[];
  };
  external: {
    ip4: string;
    ip6: string;
  };
  interfaces: any[];
}

// Multiple providers with failover; the first valid IP wins.
const IP4_PROVIDERS = ['https://ipv4.icanhazip.com', 'https://api.ipify.org', 'https://ifconfig.me/ip'];
const IP6_PROVIDERS = ['https://ipv6.icanhazip.com', 'https://api6.ipify.org', 'https://ifconfig.co/ip'];

const EXTERNAL_CACHE_TTL_MS = 60 * 1000;
let cachedExternal: { ip4: string; ip6: string; at: number } | null = null;

export class NetworkService {
  public static async getNetworkAddresses(): Promise<NetworkAddressesResult> {
    const interfaces = os.networkInterfaces();
    const internalIp4: string[] = [];
    const internalIp6: string[] = [];
    const rawInterfaces: any[] = [];

    for (const [name, netInterface] of Object.entries(interfaces)) {
      if (!netInterface) continue;
      for (const entry of netInterface) {
        if (!entry.internal) {
          if (entry.family === 'IPv4') {
            internalIp4.push(entry.address);
          } else if (entry.family === 'IPv6') {
            internalIp6.push(entry.address);
          }
        }
        rawInterfaces.push({ interface: name, ...entry });
      }
    }

    // v4 and v6 lookups run concurrently (each with provider failover),
    // cached for 60s so the dashboard and workers don't re-egress repeatedly.
    let { ip4: externalIp4, ip6: externalIp6 } = cachedExternal ?? { ip4: '', ip6: '' };
    if (cachedExternal && Date.now() - cachedExternal.at < EXTERNAL_CACHE_TTL_MS) {
      ({ ip4: externalIp4, ip6: externalIp6 } = cachedExternal);
    } else {
      [externalIp4, externalIp6] = await Promise.all([
        this.fetchPublicIp(IP4_PROVIDERS, 'ipv4'),
        this.fetchPublicIp(IP6_PROVIDERS, 'ipv6'),
      ]);
      cachedExternal = { ip4: externalIp4, ip6: externalIp6, at: Date.now() };
    }

    return {
      internal: {
        ip4: internalIp4,
        ip6: internalIp6,
      },
      external: {
        ip4: externalIp4,
        ip6: externalIp6,
      },
      interfaces: rawInterfaces,
    };
  }

  private static fetchPublicIp(urls: string[], family: 'ipv4' | 'ipv6'): Promise<string> {
    return (async () => {
      for (const url of urls) {
        const candidate = await this.fetchSingle(url);
        const valid = family === 'ipv4' ? net.isIP(candidate) === 4 : net.isIP(candidate) === 6;
        if (valid) return candidate;
      }
      return '';
    })();
  }

  private static fetchSingle(url: string): Promise<string> {
    return new Promise((resolve) => {
      const req = https.get(url, { timeout: 4000 }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve('');
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data.trim()));
      });

      req.on('error', () => resolve(''));
      req.on('timeout', () => {
        req.destroy();
        resolve('');
      });
    });
  }
}
