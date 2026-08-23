import path from 'path';
import crypto from 'crypto';
import net from 'net';
import { config } from '../engine/config';
import { FileManager } from './fileManager';
import { PlanetService } from './planetService';

export interface ClusterNode {
  nodeId: string;
  name: string;
  ip4: string;
  ip6?: string;
  domain?: string;
  port: number;
  /** Remote root's full public identity ("<addr>:0:<pub>") — required for
   *  honest unified multi-root planet builds (ج1). */
  identityPublic?: string;
  apiPort?: number;
  status: 'ONLINE' | 'OFFLINE' | 'SYNCING';
  isLocal: boolean;
  lastSyncedAt: string;
}

export interface ClusterTopology {
  clusterId: string;
  clusterName: string;
  syncSecret: string;
  nodes: ClusterNode[];
  lastUnifiedBuildAt?: string;
}

export class ClusterService {
  private static readonly MAX_NODES = 50;
  private static get clusterConfigPath(): string {
    return path.join(config.configPath, 'planet_cluster.json');
  }

  /** Strip the cluster sync secret before it ever reaches an API response. */
  private static sanitize(topology: ClusterTopology): any {
    const { syncSecret, ...rest } = topology;
    return { ...rest, hasSyncSecret: Boolean(syncSecret) };
  }

  private static isProbeableIp(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 224 || a >= 240) return false;
    return true;
  }

  /** Real reachability probe against a node's HTTP API health endpoint. */
  private static async probeNodeHealth(node: Omit<ClusterNode, 'lastSyncedAt' | 'status'>, timeoutMs = 3000): Promise<boolean> {
    if (node.isLocal) {
      const localInfo = await PlanetService.getPlanetInfo();
      return localInfo.planetExists === true;
    }
    const host = node.domain || node.ip4;
    if (!host) return false;
    const apiPort = config.port;
    const url = `http://${host}:${apiPort}/api/v1/health`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return false;
      const body: any = await res.json();
      return body && body.status === 'ok';
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * ج1: best-effort capture of a remote root's PUBLIC identity via its engine
   * (`GET /api/v1/identity/public`). Non-fatal: unified builds fail loudly
   * later with actionable guidance when an identity is missing.
   */
  private static async fetchPublicIdentity(host: string, apiPort: number): Promise<{ identityPublic?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`http://${host}:${apiPort}/api/v1/identity/public`, {
        signal: controller.signal,
      });
      if (!res.ok) return {};
      const body: any = await res.json();
      const ident = body?.data?.publicIdentity;
      const addr = body?.data?.address;
      if (typeof ident === 'string' && ident.startsWith(`${addr}:`)) {
        return { identityPublic: ident };
      }
      return {};
    } catch {
      return {};
    } finally {
      clearTimeout(timer);
    }
  }

  /** Internal loader: returns the full topology (including syncSecret) for mutations. */
  private static async loadRawTopology(): Promise<ClusterTopology> {
    if (await FileManager.fileExists(this.clusterConfigPath)) {
      try {
        const topology = await FileManager.readJson(this.clusterConfigPath);
        if (topology && Array.isArray(topology.nodes)) return topology;
      } catch {
        // Fallback to default local node initialization
      }
    }

    // Default initialization with local node
    const localInfo = await PlanetService.getPlanetInfo();
    const primaryNodeId = localInfo.nodeAddress && /^[0-9a-fA-F]{10}$/.test(localInfo.nodeAddress)
      ? localInfo.nodeAddress
      : 'planet_local_primary';

    const defaultTopology: ClusterTopology = {
      clusterId: `cluster_${Date.now()}`,
      clusterName: 'ZGALAXY Global Federated Cluster',
      syncSecret: crypto.randomBytes(24).toString('hex'),
      nodes: [
        {
          nodeId: primaryNodeId,
          name: 'Planet Primary (Local)',
          ip4: localInfo.ip4 || '127.0.0.1',
          ip6: localInfo.ip6 || '',
          domain: localInfo.domain || '',
          port: localInfo.port || 9994,
          status: localInfo.planetExists ? 'ONLINE' : 'OFFLINE',
          isLocal: true,
          lastSyncedAt: new Date().toISOString(),
        },
      ],
    };

    await FileManager.writeJson(this.clusterConfigPath, defaultTopology);
    return defaultTopology;
  }

  public static async getClusterTopology(): Promise<any> {
    return this.sanitize(await this.loadRawTopology());
  }

  public static async addNode(node: Omit<ClusterNode, 'lastSyncedAt' | 'status'>): Promise<any> {
    if (!node.nodeId || !/^[A-Za-z0-9_.-]{1,64}$/.test(node.nodeId)) {
      throw new Error(`Invalid cluster node id: '${node.nodeId}'.`);
    }
    if (!node.ip4 || net.isIP(node.ip4) !== 4) {
      throw new Error(`Invalid IPv4 address: '${node.ip4}'.`);
    }
    if (node.port && (!Number.isInteger(Number(node.port)) || Number(node.port) < 1 || Number(node.port) > 65535)) {
      throw new Error(`Invalid port: '${node.port}'.`);
    }
    // Nodes are later probed via HTTP health checks; block private/reserved IPs
    // unless ALLOW_PRIVATE_CLUSTER is enabled (e.g. for homelabs and private datacenters).
    if (!this.isProbeableIp(node.ip4) && process.env.ALLOW_PRIVATE_CLUSTER !== '1' && !node.isLocal) {
      throw new Error(`Blocked: node IP '${node.ip4}' is a private/reserved address. Set ALLOW_PRIVATE_CLUSTER=1 to allow.`);
    }

    const topology = await this.loadRawTopology();
    // Dedupe by nodeId only (IP collisions, e.g. 127.0.0.1 defaults, must not
    // overwrite unrelated entries).
    const existingIndex = topology.nodes.findIndex((n) => n.nodeId === node.nodeId);

    // Never trust a caller-supplied status: probe the node for real
    // reachability so a just-added unreachable node cannot be baked into a
    // unified planet as if it were ONLINE.
    let probedStatus: ClusterNode['status'];
    let fetchedIdentity: { identityPublic?: string } = {};
    if (node.isLocal) {
      const localInfo = await PlanetService.getPlanetInfo();
      probedStatus = localInfo.planetExists ? 'ONLINE' : 'OFFLINE';
      // Local root: its public identity is on disk.
      const publicIdPath = path.join(config.ztVarPath, 'identity.public');
      if (await FileManager.fileExists(publicIdPath)) {
        fetchedIdentity = {
          identityPublic: (await FileManager.readText(publicIdPath)).trim(),
        };
      }
    } else {
      probedStatus = (await this.probeNodeHealth(node)) ? 'ONLINE' : 'OFFLINE';
      // ج1: capture remote public identity while we can reach the peer.
      const host = node.domain || node.ip4;
      if (probedStatus === 'ONLINE' && host) {
        fetchedIdentity = await this.fetchPublicIdentity(host, config.port);
      }
    }

    const newNode: ClusterNode = {
      ...node,
      identityPublic: node.identityPublic || fetchedIdentity.identityPublic,
      status: probedStatus,
      lastSyncedAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      // Preserve local-primary flag if already set.
      if (topology.nodes[existingIndex].isLocal) newNode.isLocal = true;
      topology.nodes[existingIndex] = newNode;
    } else {
      if (topology.nodes.length >= this.MAX_NODES) {
        throw new Error(`Cluster node limit reached (max ${this.MAX_NODES}).`);
      }
      topology.nodes.push(newNode);
    }

    await FileManager.writeJson(this.clusterConfigPath, topology);
    return this.sanitize(topology);
  }

  public static async removeNode(nodeId: string): Promise<any> {
    const topology = await this.loadRawTopology();
    // Keep the local primary node (first local node) always; drop the targeted node.
    const primaryLocalIndex = topology.nodes.findIndex((n) => n.isLocal);
    if (primaryLocalIndex >= 0 && topology.nodes[primaryLocalIndex].nodeId === nodeId && topology.nodes.length === 1) {
      throw new Error(`Cannot remove the primary local cluster node '${nodeId}'.`);
    }

    const initialLen = topology.nodes.length;
    topology.nodes = topology.nodes.filter((n, idx) => {
      if (n.nodeId !== nodeId) return true;
      // Protect only the first local node if there are multiple nodes
      if (idx === primaryLocalIndex && topology.nodes.length === 1) return true;
      return false;
    });

    const removed = topology.nodes.length !== initialLen;
    if (!removed) {
      throw new Error(`Cluster node '${nodeId}' not found.`);
    }
    await FileManager.writeJson(this.clusterConfigPath, topology);
    return this.sanitize(topology);
  }

  public static async syncClusterNodes(): Promise<any> {
    const topology = await this.loadRawTopology();

    // Probe remote nodes concurrently (bounded by node count) instead of serially.
    const updatedNodes: ClusterNode[] = await Promise.all(
      topology.nodes.map(async (node: ClusterNode) => {
        if (node.isLocal) {
          const localInfo = await PlanetService.getPlanetInfo();
          return {
            ...node,
            ip4: localInfo.ip4 || node.ip4,
            domain: localInfo.domain || node.domain,
            port: localInfo.port || node.port,
            status: localInfo.planetExists ? 'ONLINE' : 'OFFLINE',
            lastSyncedAt: new Date().toISOString(),
          };
        }
        const reachable = await this.probeNodeHealth(node);
        return {
          ...node,
          status: reachable ? 'ONLINE' : 'OFFLINE',
          lastSyncedAt: new Date().toISOString(),
        };
      })
    );

    topology.nodes = updatedNodes;
    await FileManager.writeJson(this.clusterConfigPath, topology);
    return this.sanitize(topology);
  }

  public static async buildUnifiedClusterPlanet(): Promise<any> {
    const topology = await this.loadRawTopology();

    // The LOCAL node is always eligible: it is the engine serving this very
    // request, and the first unified build is what CREATES its planet file
    // (so a pre-build OFFLINE probe must not deadlock bootstrap). Remote
    // nodes still require a successful ONLINE probe.
    const eligible: ClusterNode[] = [];
    for (const n of topology.nodes as ClusterNode[]) {
      if (n.isLocal) {
        eligible.push({ ...n, status: 'ONLINE' });
      } else if (await this.probeNodeHealth(n)) {
        eligible.push({ ...n, status: 'ONLINE' });
      }
    }

    if (eligible.length === 0) {
      throw new Error('No active Planet nodes available in cluster to build unified Planet.');
    }
    const activeNodes = eligible;

    // Real multi-root compilation: every eligible node contributes a root entry,
    // carrying each node's OWN public identity (ج1).
    const buildResult = await PlanetService.buildMultiRootPlanet(
      activeNodes.map((n: ClusterNode) => ({
        nodeId: n.nodeId,
        ip4: n.ip4,
        ip6: n.ip6,
        domain: n.domain,
        port: n.port,
        isLocal: n.isLocal,
        identityPublic: n.identityPublic,
      }))
    );

    topology.lastUnifiedBuildAt = new Date().toISOString();
    await FileManager.writeJson(this.clusterConfigPath, topology);

    return {
      success: true,
      message: `Unified multi-root Cluster Planet compiled with ${activeNodes.length} roots.`,
      federatedRootsCount: activeNodes.length,
      roots: buildResult.roots,
      primaryRoot: (activeNodes.find((n: ClusterNode) => n.isLocal) || activeNodes[0]).nodeId,
      planetPath: buildResult.planetPath,
      lastUnifiedBuildAt: topology.lastUnifiedBuildAt,
    };
  }
}
