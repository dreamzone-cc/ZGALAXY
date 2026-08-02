import os from 'os';
import http from 'http';
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

export class NetworkService {
  public static async getNetworkAddresses(): Promise<NetworkAddressesResult> {
    const interfaces = os.networkInterfaces();
    const internalIp4: string[] = [];
    const internalIp6: string[] = [];
    const rawInterfaces: any[] = [];

    for (const [name, netInterface] of Object.entries(interfaces)) {
      if (!netInterface) continue;
      for (const net of netInterface) {
        if (!net.internal) {
          if (net.family === 'IPv4') {
            internalIp4.push(net.address);
          } else if (net.family === 'IPv6') {
            internalIp6.push(net.address);
          }
        }
        rawInterfaces.push({ interface: name, ...net });
      }
    }

    const externalIp4 = await this.fetchPublicIp('https://ipv4.icanhazip.com');
    const externalIp6 = await this.fetchPublicIp('https://ipv6.icanhazip.com');

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

  private static fetchPublicIp(url: string): Promise<string> {
    return new Promise((resolve) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { timeout: 3000 }, (res) => {
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
