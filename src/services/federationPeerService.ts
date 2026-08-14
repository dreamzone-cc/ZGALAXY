import path from 'path';
import crypto from 'crypto';
import net from 'net';
import { config } from '../engine/config';
import { FileManager } from './fileManager';
import { FederationTokenService, SyncMode } from './federationTokenService';
import { PlanetService } from './planetService';

export interface FederationPeer {
  nodeId: string;
  nodeName: string;
  endpoint: string;
  syncMode: SyncMode;
  connectionType: 'TRANSITIVE' | 'NON_TRANSITIVE';
  discoveredVia: string;
  status: 'ONLINE' | 'OFFLINE' | 'SYNCING';
  latencyMs: number;
  lastSyncedAt: string;
  joinedAt: string;
}

export interface FederationTopology {
  localNodeId: string;
  localNodeName: string;
  localEndpoint: string;
  peers: FederationPeer[];
}

export interface HandshakePayload {
  sourceNodeId: string;
  sourceNodeName: string;
  sourceEndpoint: string;
  tokenSecret: string;
  requestedSyncMode?: SyncMode;
}

export class FederationPeerService {
  private static readonly MAX_PEERS = 50;

  // In-process per-source handshake rate limiter (anti-flood / anti-poisoning).
  private static readonly handshakeHits = new Map<string, number[]>();
  private static readonly HANDSHAKE_WINDOW_MS = 60 * 1000;
  private static readonly HANDSHAKE_MAX_PER_WINDOW = 10;

  private static trackHandshake(sourceNodeId: string): boolean {
    const now = Date.now();
    const hits = (this.handshakeHits.get(sourceNodeId) || []).filter((t) => now - t < this.HANDSHAKE_WINDOW_MS);
    if (hits.length >= this.HANDSHAKE_MAX_PER_WINDOW) {
      this.handshakeHits.set(sourceNodeId, hits);
      return false;
    }
    hits.push(now);
    this.handshakeHits.set(sourceNodeId, hits);

    // Bound the map: attacker-supplied sourceNodeIds must not grow memory forever.
    if (this.handshakeHits.size > 1000) {
      const cutoff = now - this.HANDSHAKE_WINDOW_MS;
      for (const [key, times] of this.handshakeHits) {
        if (times.every((t) => t < cutoff)) this.handshakeHits.delete(key);
        if (this.handshakeHits.size <= 1000) break;
      }
    }
    return true;
  }

  private static get peerConfigPath(): string {
    return path.join(config.configPath, 'federation_peers.json');
  }

  private static get localTokenPath(): string {
    return path.join(config.configPath, 'federation_local_token.json');
  }

  private static get localIdentityPath(): string {
    return path.join(config.configPath, 'local_node_id.json');
  }

  /** Store the federation credential used for outbound handshakes (kept off API responses). */
  private static async saveLocalToken(tokenSecret: string): Promise<void> {
    if (!tokenSecret) return;
    try {
      await FileManager.writeJson(this.localTokenPath, {
        tokenSecret,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Non-fatal: propagation will simply need an explicit token next time.
    }
  }

  public static async getLocalToken(): Promise<string> {
    try {
      if (await FileManager.fileExists(this.localTokenPath)) {
        const data = await FileManager.readJson(this.localTokenPath);
        if (data && data.tokenSecret) return data.tokenSecret;
      }
    } catch {
      // Fall through
    }
    return '';
  }

  /**
   * SSRF guard: validate a federation target endpoint URL and block attempts to
   * reach private/reserved/internal hosts (localhost, link-local, metadata, etc.).
   * Throws on disallowed scheme, private IP, or unroutable host.
   */
  public static async assertSafeTargetUrl(rawUrl: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`Invalid target endpoint URL: ${rawUrl}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Federation target endpoint must use http:// or https://.');
    }
    if (!parsed.hostname) {
      throw new Error('Federation target endpoint must include a hostname.');
    }
    if (parsed.hostname === 'localhost' || parsed.hostname === 'localhost.') {
      throw new Error(`Blocked: localhost targets are not allowed (${rawUrl}).`);
    }

    let address: string | null = parsed.hostname;
    const isIP = net.isIP(parsed.hostname);
    if (isIP === 0) {
      try {
        const { resolve4 } = await import('dns/promises');
        const addrs = await resolve4(parsed.hostname, { ttl: true });
        if (!addrs.length) throw new Error('No A records.');
        address = addrs[0].address;
      } catch {
        throw new Error(`Unable to resolve federation target host: ${parsed.hostname}.`);
      }
    }

    if (address && isIP !== 6 && !this.isPublicIp(address)) {
      throw new Error(`Blocked: resolution to private/reserved address ${address} is not allowed.`);
    }
  }

  private static isPublicIp(ip: string): boolean {
    if (!net.isIP(ip)) return false;
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0) return false;                      // 0.0.0.0/8
    if (a === 10) return false;                     // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64.0.0/10
    if (a === 127) return false;                    // loopback
    if (a === 169 && b === 254) return false;       // link-local
    if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
    if (a === 192 && b === 168) return false;       // 192.168.0.0/16
    if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 benchmarking
    if (a === 224 || a >= 240) return false;        // multicast + reserved
    return true;
  }

  public static async getLocalNodeId(): Promise<string> {
    if (await FileManager.fileExists(this.localIdentityPath)) {
      try {
        const data = await FileManager.readJson(this.localIdentityPath);
        if (data && data.nodeId) return data.nodeId;
      } catch {
        // Fallback
      }
    }
    const nodeId = `zgalaxy_node_${crypto.randomBytes(4).toString('hex')}`;
    await FileManager.writeJson(this.localIdentityPath, { nodeId, createdAt: new Date().toISOString() });
    return nodeId;
  }

  public static async getPeerTopology(): Promise<FederationTopology> {
    const localNodeId = await this.getLocalNodeId();
    const planetInfo = await PlanetService.getPlanetInfo();
    const apiPort = config.port;
    const localEndpoint = planetInfo.domain
      ? `http://${planetInfo.domain}:${apiPort}`
      : `http://${planetInfo.ip4 || '127.0.0.1'}:${apiPort}`;

    if (await FileManager.fileExists(this.peerConfigPath)) {
      try {
        const data = await FileManager.readJson(this.peerConfigPath);
        return {
          localNodeId,
          localNodeName: data.localNodeName || `ZGalaxy Node (${localNodeId.substring(0, 12)})`,
          localEndpoint,
          peers: data.peers || [],
        };
      } catch {
        // Fallback
      }
    }

    const defaultTopology: FederationTopology = {
      localNodeId,
      localNodeName: `ZGalaxy Primary Node (${localNodeId.substring(0, 12)})`,
      localEndpoint,
      peers: [],
    };
    await FileManager.writeJson(this.peerConfigPath, defaultTopology);
    return defaultTopology;
  }

  private static peerMutex: Promise<unknown> = Promise.resolve();

  private static async serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.peerMutex.then(fn, fn);
    this.peerMutex = result.catch(() => {});
    return result;
  }

  private static async savePeerTopology(topology: FederationTopology): Promise<void> {
    await FileManager.writeJson(this.peerConfigPath, topology);
  }

  // Handle incoming inter-node handshake request
  public static async handleIncomingHandshake(payload: HandshakePayload): Promise<any> {
    return this.serialize(async () => {
      if (!payload || typeof payload !== 'object') {
        throw new Error('Malformed handshake payload.');
      }
      if (!payload.sourceNodeId || !/^[A-Za-z0-9_.-]{1,64}$/.test(payload.sourceNodeId)) {
        throw new Error('Invalid sourceNodeId.');
      }
      if (!payload.sourceEndpoint || typeof payload.sourceEndpoint !== 'string') {
        throw new Error('sourceEndpoint is required.');
      }
      await this.assertSafeTargetUrl(payload.sourceEndpoint);
      if (!this.trackHandshake(payload.sourceNodeId)) {
        throw new Error('Too many handshake attempts from this source. Please try again later.');
      }

      const tokenResult = await FederationTokenService.validateToken(payload.tokenSecret, 'WRITE');
      if (!tokenResult.valid || !tokenResult.token) {
        throw new Error(`Federation Handshake Failed: ${tokenResult.error}`);
      }

      const token = tokenResult.token;

      // Validate a caller-supplied sync mode (M7): only the two known modes are
      // accepted; a garbage value would otherwise be persisted as-is.
      const requestedMode = payload.requestedSyncMode as string | undefined;
      if (requestedMode && requestedMode !== 'FEDERATION_INHERITED' && requestedMode !== 'DIRECT_ISOLATED') {
        throw new Error(
          `Invalid requestedSyncMode '${requestedMode}'. Allowed: FEDERATION_INHERITED, DIRECT_ISOLATED.`
        );
      }
      const effectiveSyncMode: SyncMode = (requestedMode || token.syncMode || 'FEDERATION_INHERITED') as SyncMode;
      const isTransitive = effectiveSyncMode === 'FEDERATION_INHERITED';

      const topology = await this.getPeerTopology();

      // A node must not register itself as a peer.
      if (payload.sourceNodeId === topology.localNodeId) {
        throw new Error('Cannot register the local node as its own peer.');
      }

      // Bound inbound identity fields to sane sizes.
      if ((payload.sourceNodeName && payload.sourceNodeName.length > 128) || payload.sourceEndpoint.length > 512) {
        throw new Error('Handshake fields exceed allowed size limits.');
      }

      // Anti-poisoning: enforce a hard cap on the peer table.
      if (
        topology.peers.length >= this.MAX_PEERS &&
        !topology.peers.some((p: any) => p.nodeId === payload.sourceNodeId)
      ) {
        throw new Error(`Peer table is full (max ${this.MAX_PEERS}). Rejecting new peer.`);
      }

      const peerNode: FederationPeer = {
        nodeId: payload.sourceNodeId,
        nodeName: payload.sourceNodeName || `Node_${payload.sourceNodeId.substring(0, 8)}`,
        endpoint: payload.sourceEndpoint,
        syncMode: effectiveSyncMode,
        connectionType: isTransitive ? 'TRANSITIVE' : 'NON_TRANSITIVE',
        discoveredVia: 'DIRECT_HANDSHAKE',
        status: 'ONLINE',
        latencyMs: 1.0,
        lastSyncedAt: new Date().toISOString(),
        joinedAt: new Date().toISOString(),
      };

      const existingIndex = topology.peers.findIndex((p: any) => p.nodeId === payload.sourceNodeId);
      if (existingIndex >= 0) {
        peerNode.joinedAt = topology.peers[existingIndex].joinedAt || peerNode.joinedAt;
        topology.peers[existingIndex] = peerNode;
      } else {
        topology.peers.push(peerNode);
      }

      await this.savePeerTopology(topology);

      // Only return shareable peers if effective mode is FEDERATION_INHERITED.
      // DIRECT_ISOLATED nodes must not receive (nor share) the broader mesh list.
      const shareablePeers = isTransitive
        ? topology.peers
            .filter((p: any) => p.nodeId !== payload.sourceNodeId && p.syncMode === 'FEDERATION_INHERITED')
            .slice(0, 50)
        : [];

      return {
        success: true,
        responderNodeId: topology.localNodeId,
        responderNodeName: topology.localNodeName,
        responderEndpoint: topology.localEndpoint,
        effectiveSyncMode,
        connectionType: peerNode.connectionType,
        shareablePeers,
        message: `Handshake successful in [${effectiveSyncMode}] mode.`,
      };
    });
  }

  /**
   * Perform a trusted handshake against a target peer endpoint, merging any
   * returned INHERITED peers (with loop detection + cap) into the local topology.
   * Retries with backoff; throws only after retries are exhausted.
   */
  private static async performHandshake(
    targetEndpoint: string,
    tokenSecret: string,
    requestedMode?: SyncMode,
    retries = 2
  ): Promise<{ resData: any; discoveredCount: number }> {
    const effectiveToken = tokenSecret || (await this.getLocalToken());
    if (!effectiveToken) {
      throw new Error('Federation Token secret is required for handshake.');
    }

    await this.assertSafeTargetUrl(targetEndpoint);

    const cleanEndpoint = targetEndpoint.endsWith('/') ? targetEndpoint.slice(0, -1) : targetEndpoint;
    const topology = await this.getPeerTopology();

    const payload: HandshakePayload = {
      sourceNodeId: topology.localNodeId,
      sourceNodeName: topology.localNodeName,
      sourceEndpoint: topology.localEndpoint,
      tokenSecret: effectiveToken.trim(),
      requestedSyncMode: requestedMode,
    };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, attempt * 500));
      }
      try {
        const response = await fetch(`${cleanEndpoint}/api/v1/federation/handshake`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
        const resData: any = await response.json();
        if (!resData || !resData.success) {
          throw new Error(resData?.error || 'Failed to complete Federation Handshake with target node.');
        }

        const syncMode: SyncMode = resData.effectiveSyncMode || requestedMode || 'FEDERATION_INHERITED';
        const isTransitive = syncMode === 'FEDERATION_INHERITED';

        // Register primary target node as peer
        const targetPeer: FederationPeer = {
          nodeId: resData.responderNodeId,
          nodeName: resData.responderNodeName,
          endpoint: resData.responderEndpoint || cleanEndpoint,
          syncMode,
          connectionType: isTransitive ? 'TRANSITIVE' : 'NON_TRANSITIVE',
          discoveredVia: 'DIRECT_JOIN',
          status: 'ONLINE',
          latencyMs: 1.5,
          lastSyncedAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        };

        const existingIdx = topology.peers.findIndex((p) => p.nodeId === targetPeer.nodeId);
        if (existingIdx >= 0) {
          // Preserve the original joinedAt for already-known peers.
          targetPeer.joinedAt = topology.peers[existingIdx].joinedAt || targetPeer.joinedAt;
          topology.peers[existingIdx] = targetPeer;
        } else if (topology.peers.length < this.MAX_PEERS) {
          topology.peers.push(targetPeer);
        }

        // Process inherited automatic peer discovery ONLY if mode is FEDERATION_INHERITED
        let discoveredCount = 0;
        if (syncMode === 'FEDERATION_INHERITED' && Array.isArray(resData.shareablePeers)) {
          for (const sharedPeer of resData.shareablePeers) {
            if (!sharedPeer || sharedPeer.nodeId === topology.localNodeId) continue;
            if (topology.peers.some((p) => p.nodeId === sharedPeer.nodeId)) continue;
            if (topology.peers.length >= this.MAX_PEERS) break;
            const inheritedPeer: FederationPeer = {
              ...sharedPeer,
              syncMode: 'FEDERATION_INHERITED',
              connectionType: 'TRANSITIVE',
              discoveredVia: resData.responderNodeId,
              lastSyncedAt: new Date().toISOString(),
            };
            topology.peers.push(inheritedPeer);
            discoveredCount++;
          }
        }

        if (effectiveToken) {
          await this.saveLocalToken(effectiveToken);
        }
        await this.savePeerTopology(topology);
        return { resData, discoveredCount };
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError || new Error('Handshake failed.');
  }

  // Initiate joining a remote ZGALAXY node via Federation Token
  public static async joinFederation(
    targetEndpoint: string,
    tokenSecret: string,
    requestedMode?: SyncMode
  ): Promise<any> {
    const { resData, discoveredCount } = await this.performHandshake(targetEndpoint, tokenSecret, requestedMode);
    const topology = await this.getPeerTopology();
    const syncMode: SyncMode = resData.effectiveSyncMode || requestedMode || 'FEDERATION_INHERITED';

    return {
      success: true,
      targetNodeId: resData.responderNodeId,
      syncMode,
      discoveredPeersCount: discoveredCount,
      totalMeshPeers: topology.peers.length,
      message: `Joined Federation successfully in [${syncMode}] mode. Discovered ${discoveredCount} inherited peers.`,
    };
  }

  // Trigger manual or background mesh topology propagation (real fan-out)
  public static async propagateMeshTopology(): Promise<any> {
    const topology = await this.getPeerTopology();
    const inheritedPeers = topology.peers.filter(
      (p) => p.syncMode === 'FEDERATION_INHERITED' && p.status === 'ONLINE' && p.endpoint
    );

    if (inheritedPeers.length === 0) {
      return { propagatedPeersCount: 0, message: 'No INHERITED peers to propagate to.' };
    }

    // Fan out in parallel with a bounded concurrency pool so one dead peer
    // never stalls the whole propagation (was sequential O(N) with retries).
    const CONCURRENCY = 8;
    let propagatedCount = 0;
    let totalDiscovered = 0;
    const failures: string[] = [];

    const results = await runPool(inheritedPeers, CONCURRENCY, async (peer) => {
      try {
        const { discoveredCount } = await this.performHandshake(peer.endpoint, '', 'FEDERATION_INHERITED', 1);
        return { ok: true as const, discoveredCount };
      } catch (err: any) {
        return { ok: false as const, error: `${peer.nodeId}: ${err.message}` };
      }
    });

    for (const r of results) {
      if (r.ok) {
        propagatedCount++;
        totalDiscovered += r.discoveredCount;
      } else {
        failures.push(r.error);
      }
    }

    const message =
      failures.length > 0
        ? `Propagated to ${propagatedCount}/${inheritedPeers.length} peers (${failures.length} failed).`
        : `Propagated mesh topology to ${propagatedCount} peers.`;

    return {
      propagatedPeersCount: propagatedCount,
      discoveredPeersCount: totalDiscovered,
      totalMeshPeers: (await this.getPeerTopology()).peers.length,
      failures,
      message,
    };
  }

  // Remove / Disconnect a peer from the local node
  public static async removePeer(nodeId: string): Promise<boolean> {
    return this.serialize(async () => {
      const topology = await this.getPeerTopology();
      const initialLen = topology.peers.length;
      topology.peers = topology.peers.filter((p) => p.nodeId !== nodeId);

      if (topology.peers.length !== initialLen) {
        await this.savePeerTopology(topology);
        return true;
      }
      return false;
    });
  }
}

/** Run async tasks with a bounded concurrency pool, preserving result order. */
async function runPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
