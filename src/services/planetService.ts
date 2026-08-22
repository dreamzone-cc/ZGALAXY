import path from 'path';
import net from 'net';
import dns from 'dns/promises';
import { config } from '../engine/config';
import { CliService } from './cliService';
import { FileManager } from './fileManager';
import { DomainService } from './domainService';
import { buildMutex } from './mutex';
import pkg from '../../package.json';

export interface PlanetBuildConfig {
  ip4?: string;
  ip6?: string;
  domain?: string;
  port?: number;
}

export interface PlanetRootNode {
  nodeId: string;
  ip4?: string;
  ip6?: string;
  domain?: string;
  port?: number;
  isLocal?: boolean;
}

export class PlanetService {
  public static async getPlanetInfo(): Promise<any> {
    const planetPath = path.join(config.distPath, 'planet');
    const exists = await FileManager.fileExists(planetPath);

    const ip4File = path.join(config.configPath, 'ip_addr4');
    const ip6File = path.join(config.configPath, 'ip_addr6');
    const domainFile = path.join(config.configPath, 'domain');

    const ip4 = (await FileManager.fileExists(ip4File)) ? await FileManager.readText(ip4File) : '';
    const ip6 = (await FileManager.fileExists(ip6File)) ? await FileManager.readText(ip6File) : '';
    const domain = (await FileManager.fileExists(domainFile)) ? await FileManager.readText(domainFile) : '';

    return {
      planetExists: exists,
      planetPath: exists ? planetPath : null,
      ip4: ip4.trim(),
      ip6: ip6.trim(),
      domain: domain.trim(),
      port: config.ztPort,
      version: pkg.version,
      status: exists ? 'ACTIVE' : 'NOT_CONFIGURED',
      health: exists ? 'HEALTHY' : 'UNHEALTHY',
    };
  }

  public static async buildPlanet(options: PlanetBuildConfig): Promise<any> {
    return buildMutex.run(() => this.buildPlanetInner(options));
  }

  private static async buildPlanetInner(options: PlanetBuildConfig): Promise<any> {
    const port = options.port || config.ztPort;
    const ip4 = options.ip4 || '';
    const ip6 = options.ip6 || '';
    const domain = options.domain || '';

    // Validate inputs so arbitrary strings are never baked into world.bin.
    if (port && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new Error('Port must be an integer between 1 and 65535.');
    }
    if (ip4 && net.isIP(ip4) !== 4) {
      throw new Error(`Invalid IPv4 address: '${ip4}'.`);
    }
    if (ip6 && net.isIP(ip6) !== 6) {
      throw new Error(`Invalid IPv6 address: '${ip6}'.`);
    }
    if (domain) {
      const trimmed = domain.trim();
      // Stricter hostname check: each label must not start/end with '-', no
      // empty labels ('a..b'), max 253 chars (L5).
      if (
        trimmed.length > 253 ||
        !/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)*$/i.test(trimmed)
      ) {
        throw new Error(`Invalid domain name: '${domain}'.`);
      }
    }

    // Dynamic-IP handling: the ZeroTier world/moon build tools (mkmoonworld /
    // genmoon) only keep IP endpoints and silently drop hostname endpoints.
    // Therefore a configured domain is RESOLVED to its current A records and
    // those IPs are injected as the stable endpoints. When the domain's IP
    // changes (dynamic IP), a rebuild resolves it again — clients get the new
    // IP without relying on the domain string surviving in the world file.
    const resolvedIps: string[] = [];
    if (domain) {
      try {
        const records = await dns.resolve4(domain.trim());
        for (const r of records) {
          if (net.isIP(r) === 4 && !resolvedIps.includes(r)) resolvedIps.push(r);
        }
      } catch {
        // resolution failure is non-fatal; fall back to explicit ip4/ip6
      }
    }

    // Endpoint order matters for latency: ZeroTier tries stableEndpoints in
    // order, so put the resolved public IPv4 path first (dynamic, current IP),
    // then explicit IPv4/IPv6, then the domain (documentation only — dropped
    // by the build tools, kept for tooling/debugging).
    const stableEndpoints: string[] = [];
    for (const rip of resolvedIps) stableEndpoints.push(`${rip}/${port}`);
    if (ip4 && !resolvedIps.includes(ip4)) stableEndpoints.push(`${ip4}/${port}`);
    if (ip6) stableEndpoints.push(`${ip6}/${port}`);
    if (domain) {
      stableEndpoints.push(`${domain.trim()}/${port}`);
    }

    if (stableEndpoints.length === 0) {
      throw new Error('At least one IPv4, IPv6, or Domain Name must be provided.');
    }

    // Honest failure: if the domain did NOT resolve and no explicit IPv4/IPv6
    // was given, the only stable endpoint is the hostname string, which the
    // ZeroTier build tools drop — the resulting planet would have NO reachable
    // root and every client would fail. Refuse instead of building silently.
    if (resolvedIps.length === 0 && !ip4 && !ip6) {
      throw new Error(
        `Domain '${domain}' could not be resolved to any IP and no explicit IPv4/IPv6 was provided. ` +
          `ZeroTier build tools drop hostname endpoints, so the planet would have no reachable root.`
      );
    }

    const moonJsonPath = path.join(config.ztVarPath, 'moon.json');
    if (!(await FileManager.fileExists(moonJsonPath))) {
      // Auto-create an initial moon.json template if missing.
      const initialMoonJson = {
        id: '1000000000',
        objtype: 'moon',
        roots: [
          {
            id: '1000000000',
            stableEndpoints,
          },
        ],
        signingKey: '',
        signingKey_secret: '',
      };
      await FileManager.writeJson(moonJsonPath, initialMoonJson);
    }

    const moonData = await this.ensureMoonJsonKeys();

    if (moonData.roots && moonData.roots.length > 0) {
      moonData.roots[0].stableEndpoints = stableEndpoints;
    } else {
      moonData.roots = [{ id: moonData.id || '1000000000', stableEndpoints }];
    }

    await FileManager.writeJson(moonJsonPath, moonData);

    const idToolCmd = await this.resolveIdTool();
    const mkMoonWorldCmd = await this.resolveMkMoonWorld();

    const generatedWorldBin = path.join(config.ztVarPath, 'world.bin');
    const targetPlanetPath = path.join(config.distPath, 'planet');

    try {
      await CliService.executeCommandArray(idToolCmd, ['genmoon', 'moon.json'], config.ztVarPath);
      await CliService.executeCommandArray(mkMoonWorldCmd, ['moon.json'], config.ztVarPath);
    } catch (cmdErr: any) {
      // Honest failure: never write a placeholder and claim success when the
      // tooling is unavailable (P1-1.2 / M4). idtool/mkmoonworld are provided
      // natively by the zgalaxy-rs binary (symlinked under the classic
      // zerotier-idtool / mkmoonworld-x86_64 names) — no ZeroTier C++ tools.
      throw new Error(
        `Planet build failed: the zgalaxy-rs client binary is required (${cmdErr.message}).`
      );
    }

    if (!(await FileManager.fileExists(generatedWorldBin))) {
      throw new Error(
        'Planet build failed: zgalaxy-rs did not produce world.bin. Check the zerotier-idtool / mkmoonworld symlinks.'
      );
    }
    await FileManager.copyFile(generatedWorldBin, targetPlanetPath);

    // Always overwrite address files so a rebuild with fewer fields never leaves
    // stale values behind (consumed by getPlanetInfo and the DDNS worker).
    await FileManager.writeText(path.join(config.configPath, 'ip_addr4'), ip4);
    await FileManager.writeText(path.join(config.configPath, 'ip_addr6'), ip6);
    await FileManager.writeText(path.join(config.configPath, 'domain'), domain);

    // Bind the domain only after a successful build.
    if (domain) {
      await DomainService.bindDomain(domain, 'PLANET');
    }

    return {
      success: true,
      message: 'Planet built successfully.',
      stableEndpoints,
      planetPath: targetPlanetPath,
    };
  }

  /**
   * Ensure moon.json carries valid signing keys, running initmoon to
   * regenerate real keys from identity.public when they are missing.
   *
   * Critical: a key-less moon.json template makes genmoon fail forever, so this
   * self-healing MUST run before any genmoon/mkmoonworld call — both for the
   * single-root and the multi-root planet build.
   * Note: zerotier-idtool 1.16.x emits the secret under "signingKey_SECRET"
   * (uppercase) — both spellings are accepted.
   *
   * @return The (possibly regenerated) moon.json content.
   */
  private static async ensureMoonJsonKeys(): Promise<any> {
    const moonJsonPath = path.join(config.ztVarPath, 'moon.json');
    let moonData = await FileManager.readJson(moonJsonPath).catch(() => ({}));
    const hasSecret = (w: any) => Boolean(w && (w.signingKey_secret || w.signingKey_SECRET));
    if (!moonData.signingKey || !hasSecret(moonData)) {
      const identityPub = path.join(config.ztVarPath, 'identity.public');
      if (!(await FileManager.fileExists(identityPub))) {
        throw new Error(
          'Planet build failed: moon.json has no signing keys and identity.public is missing. ' +
            'Run identity/generate first (requires zerotier-idtool).'
        );
      }
      const idTool = await this.resolveIdTool();
      const initResult = await CliService.executeCommandArray(idTool, ['initmoon', 'identity.public'], config.ztVarPath);
      if (!initResult.stdout) {
        throw new Error('Planet build failed: initmoon produced no output while regenerating signing keys.');
      }
      await FileManager.writeText(moonJsonPath, initResult.stdout);
      const reInit = await FileManager.readJson(moonJsonPath);
      if (!reInit.signingKey || !hasSecret(reInit)) {
        throw new Error('Planet build failed: initmoon did not regenerate signing keys.');
      }
      moonData = reInit;
    }
    return moonData;
  }

  /** Resolve the zerotier-idtool binary path (honors config.idToolPath). */
  public static async resolveIdTool(): Promise<string> {
    if (config.idToolPath && (await FileManager.fileExists(config.idToolPath))) {
      return config.idToolPath;
    }
    const ztVar = path.join(config.ztVarPath, 'zerotier-idtool');
    if (await FileManager.fileExists(ztVar)) {
      return path.join(config.ztVarPath, './zerotier-idtool');
    }
    const app = path.join(config.appPath, 'zerotier-idtool');
    if (await FileManager.fileExists(app)) {
      return app;
    }
    return 'zerotier-idtool';
  }

  /** Resolve the mkmoonworld binary path (honors config.mkmoonworldPath). */
  public static async resolveMkMoonWorld(): Promise<string> {
    if (config.mkmoonworldPath && (await FileManager.fileExists(config.mkmoonworldPath))) {
      return config.mkmoonworldPath;
    }
    const ztVar = path.join(config.ztVarPath, 'mkmoonworld-x86_64');
    if (await FileManager.fileExists(ztVar)) {
      return path.join(config.ztVarPath, './mkmoonworld-x86_64');
    }
    const app = path.join(config.appPath, 'mkmoonworld-x86_64');
    if (await FileManager.fileExists(app)) {
      return app;
    }
    return 'mkmoonworld-x86_64';
  }

  /**
   * Build a true multi-root Planet: every provided root node contributes its own
   * stable endpoint to moon.json.roots[], then genmoon + mkmoonworld compile it.
   * No placeholder fallback: if the CLI fails, we throw instead of faking success.
   */
  public static async buildMultiRootPlanet(roots: PlanetRootNode[]): Promise<any> {
    return buildMutex.run(() => this.buildMultiRootPlanetInner(roots));
  }

  private static async buildMultiRootPlanetInner(roots: PlanetRootNode[]): Promise<any> {
    if (!roots || roots.length === 0) {
      throw new Error('At least one Planet root node is required.');
    }

    const rootEntries = await Promise.all(
      roots.map(async (node) => {
      const port = node.port || config.ztPort;
      // Dynamic-IP handling: resolve each node's domain to its current A
      // records and use those IPs (the build tools drop hostname endpoints).
      const resolvedIps: string[] = [];
      if (node.domain) {
        try {
          const records = await dns.resolve4(node.domain.trim());
          for (const r of records) {
            if (net.isIP(r) === 4 && !resolvedIps.includes(r)) resolvedIps.push(r);
          }
        } catch {
          // non-fatal
        }
      }
      // Resolved public IPv4 first (dynamic), then explicit IPv4/IPv6, then domain.
      const stableEndpoints: string[] = [];
      for (const rip of resolvedIps) stableEndpoints.push(`${rip}/${port}`);
      if (node.ip4 && !resolvedIps.includes(node.ip4)) stableEndpoints.push(`${node.ip4}/${port}`);
      if (node.ip6) stableEndpoints.push(`${node.ip6}/${port}`);
      let resolvedNodeId = node.nodeId || '';
      if (!/^[0-9a-f]{10}$/i.test(resolvedNodeId)) {
        const publicIdPath = path.join(config.ztVarPath, 'identity.public');
        if (await FileManager.fileExists(publicIdPath)) {
          const content = await FileManager.readText(publicIdPath);
          const addr = content.split(':')[0]?.trim();
          if (addr && /^[0-9a-f]{10}$/i.test(addr)) {
            resolvedNodeId = addr;
          }
        }
      }
      // ZeroTier root ids are 10-hex addresses; arbitrary cluster nodeIds break genmoon.
      if (!/^[0-9a-f]{10}$/i.test(resolvedNodeId)) {
        throw new Error(`Invalid root node id '${node.nodeId}' — ZeroTier roots require a 10-hex address.`);
      }
      return {
        id: resolvedNodeId,
        stableEndpoints,
      };
      })
    );

    if (rootEntries.some((r) => r.stableEndpoints.length === 0)) {
      throw new Error('Each Planet root node must have at least one IPv4, IPv6, or domain endpoint.');
    }

    const moonJsonPath = path.join(config.ztVarPath, 'moon.json');
    // Same signing-key self-healing as the single-root build (M5): a key-less
    // moon.json makes genmoon fail forever, so ensure keys first.
    const moonData: any = await this.ensureMoonJsonKeys();
    moonData.objtype = 'moon';

    const publicIdPath = path.join(config.ztVarPath, 'identity.public');
    let localIdentityStr = '';
    if (await FileManager.fileExists(publicIdPath)) {
      localIdentityStr = (await FileManager.readText(publicIdPath)).trim();
    }
    const defaultRootIdentity = (moonData.roots && moonData.roots[0]?.identity) || localIdentityStr;

    const formattedRoots = rootEntries.map((r, idx) => {
      const isLocalRoot = (localIdentityStr && localIdentityStr.startsWith(r.id)) || idx === 0;
      const ident = isLocalRoot ? (localIdentityStr || defaultRootIdentity) : defaultRootIdentity;
      return {
        identity: ident,
        stableEndpoints: r.stableEndpoints,
      };
    });

    moonData.roots = formattedRoots;
    await FileManager.writeJson(moonJsonPath, moonData);

    const idToolCmd = await this.resolveIdTool();
    const mkMoonWorldCmd = await this.resolveMkMoonWorld();

    const generatedWorldBin = path.join(config.ztVarPath, 'world.bin');
    const targetPlanetPath = path.join(config.distPath, 'planet');

    await CliService.executeCommandArray(idToolCmd, ['genmoon', 'moon.json'], config.ztVarPath);
    await CliService.executeCommandArray(mkMoonWorldCmd, ['moon.json'], config.ztVarPath);

    if (!(await FileManager.fileExists(generatedWorldBin))) {
      throw new Error('mkmoonworld completed but no world.bin was generated.');
    }
    await FileManager.copyFile(generatedWorldBin, targetPlanetPath);

    return {
      success: true,
      message: `Unified multi-root Planet built with ${rootEntries.length} roots.`,
      rootsCount: rootEntries.length,
      roots: rootEntries.map((r) => ({ nodeId: r.id, stableEndpoints: r.stableEndpoints })),
      planetPath: targetPlanetPath,
    };
  }

  public static async deletePlanet(): Promise<any> {
    const planetPath = path.join(config.distPath, 'planet');
    if (await FileManager.fileExists(planetPath)) {
      const fs = require('fs/promises');
      await fs.unlink(planetPath);
      return { success: true, message: 'Planet deleted successfully.' };
    }
    return { success: true, message: 'Planet was not found.' };
  }

  public static async validatePlanet(): Promise<any> {
    const planetPath = path.join(config.distPath, 'planet');
    const exists = await FileManager.fileExists(planetPath);
    if (!exists) {
      return { valid: false, reason: 'Planet binary file world.bin does not exist.' };
    }
    const fs = require('fs/promises');
    const stats = await fs.stat(planetPath);
    if (stats.size === 0) {
      return { valid: false, reason: 'Planet binary file is empty.' };
    }
    const crypto = require('crypto');
    const data = await fs.readFile(planetPath);
    const checksum = crypto.createHash('sha256').update(data).digest('hex');
    return { valid: true, planetPath, sizeBytes: stats.size, sha256: checksum };
  }

  public static getTemplates(): any {
    return {
      singleNode: {
        description: 'Single-node Planet setup with single public IPv4',
        defaultPort: 9994,
      },
      domainNameBinding: {
        description: 'Domain name bound Planet setup (e.g. planet.example.com)',
        defaultPort: 9994,
      },
      dualStack: {
        description: 'Dual-stack IPv4 & IPv6 Planet setup',
        defaultPort: 9994,
      },
      multiRegionHA: {
        description: 'Multi-region High Availability Planet & Moon deployment template',
        recommendedMoons: 2,
      },
    };
  }
}
