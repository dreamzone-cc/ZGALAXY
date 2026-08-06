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
  identityPublic?: string;
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
  private static async probeNodeHealth(node: ClusterNode, timeoutMs = 3000): Promise<boolean> {
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
    const defaultTopology: ClusterTopology = {
      clusterId: `cluster_${Date.now()}`,
      clusterName: 'ZGALAXY Global Federated Cluster',
      syncSecret: crypto.randomBytes(24).toString('hex'),
      nodes: [
        {
          nodeId: 'planet_local_primary',
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

  public static async addNode(node: Omit<ClusterNode, 'lastSyncedAt'>): Promise<any> {
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
    // so a low-privilege caller cannot use the ONLINE/OFFLINE result as an
    // internal-network oracle (mirrors the federation SSRF guard).
    if (!this.isProbeableIp(node.ip4)) {
      throw new Error(`Blocked: node IP '${node.ip4}' is a private/reserved address.`);
    }

    const topology = await this.loadRawTopology();
    // Dedupe by nodeId only (IP collisions, e.g. 127.0.0.1 defaults, must not
    // overwrite unrelated entries).
    const existingIndex = topology.nodes.findIndex((n) => n.nodeId === node.nodeId);

    const newNode: ClusterNode = {
      ...node,
      lastSyncedAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
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
    // Keep the local primary node always; drop only the targeted node.
    // (The previous predicate also removed the local node on every call.)
    const initialLen = topology.nodes.length;
    topology.nodes = topology.nodes.filter((n) => n.nodeId !== nodeId || n.isLocal);
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
    const activeNodes = topology.nodes.filter((n: ClusterNode) => n.status === 'ONLINE');

    if (activeNodes.length === 0) {
      throw new Error('No active Planet nodes available in cluster to build unified Planet.');
    }

    // Real multi-root compilation: every ONLINE node contributes a root entry.
    const buildResult = await PlanetService.buildMultiRootPlanet(
      activeNodes.map((n: ClusterNode) => ({
        nodeId: n.nodeId,
        ip4: n.ip4,
        ip6: n.ip6,
        domain: n.domain,
        port: n.port,
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
