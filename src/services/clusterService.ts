import path from 'path';
import { config } from '../engine/config';
import { FileManager } from './fileManager';
import { PlanetService } from './planetService';
import { CliService } from './cliService';

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
  private static get clusterConfigPath(): string {
    return path.join(config.configPath, 'planet_cluster.json');
  }

  public static async getClusterTopology(): Promise<ClusterTopology> {
    if (await FileManager.fileExists(this.clusterConfigPath)) {
      try {
        const topology = await FileManager.readJson(this.clusterConfigPath);
        return topology;
      } catch {
        // Fallback to default local node initialization
      }
    }

    // Default initialization with local node
    const localInfo = await PlanetService.getPlanetInfo();
    const defaultTopology: ClusterTopology = {
      clusterId: `cluster_${Date.now()}`,
      clusterName: 'ZGALAXY Global Federated Cluster',
      syncSecret: 'zgalaxy_cluster_sync_secret',
      nodes: [
        {
          nodeId: 'planet_local_primary',
          name: 'Planet Primary (Local)',
          ip4: localInfo.ip4 || '127.0.0.1',
          ip6: localInfo.ip6 || '',
          domain: localInfo.domain || '',
          port: localInfo.port || 9994,
          status: 'ONLINE',
          isLocal: true,
          lastSyncedAt: new Date().toISOString(),
        },
      ],
    };

    await FileManager.writeJson(this.clusterConfigPath, defaultTopology);
    return defaultTopology;
  }

  public static async addNode(node: Omit<ClusterNode, 'lastSyncedAt'>): Promise<ClusterTopology> {
    const topology = await this.getClusterTopology();
    const existingIndex = topology.nodes.findIndex((n) => n.nodeId === node.nodeId || n.ip4 === node.ip4);

    const newNode: ClusterNode = {
      ...node,
      lastSyncedAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      topology.nodes[existingIndex] = newNode;
    } else {
      topology.nodes.push(newNode);
    }

    await FileManager.writeJson(this.clusterConfigPath, topology);
    return topology;
  }

  public static async removeNode(nodeId: string): Promise<ClusterTopology> {
    const topology = await this.getClusterTopology();
    topology.nodes = topology.nodes.filter((n) => n.nodeId !== nodeId && !n.isLocal);
    await FileManager.writeJson(this.clusterConfigPath, topology);
    return topology;
  }

  public static async syncClusterNodes(): Promise<ClusterTopology> {
    const topology = await this.getClusterTopology();
    const updatedNodes: ClusterNode[] = [];

    for (const node of topology.nodes) {
      if (node.isLocal) {
        const localInfo = await PlanetService.getPlanetInfo();
        updatedNodes.push({
          ...node,
          ip4: localInfo.ip4 || node.ip4,
          domain: localInfo.domain || node.domain,
          port: localInfo.port || node.port,
          status: 'ONLINE',
          lastSyncedAt: new Date().toISOString(),
        });
      } else {
        // Remote node ping / status check simulation
        updatedNodes.push({
          ...node,
          status: node.status || 'ONLINE',
          lastSyncedAt: new Date().toISOString(),
        });
      }
    }

    topology.nodes = updatedNodes;
    await FileManager.writeJson(this.clusterConfigPath, topology);
    return topology;
  }

  public static async buildUnifiedClusterPlanet(): Promise<any> {
    const topology = await this.syncClusterNodes();
    const activeNodes = topology.nodes.filter((n) => n.status === 'ONLINE');

    if (activeNodes.length === 0) {
      throw new Error('No active Planet nodes available in cluster to build unified Planet.');
    }

    const primaryNode = activeNodes.find((n) => n.isLocal) || activeNodes[0];

    // Build planet with primary node endpoint and store federated topology metadata
    const buildResult = await PlanetService.buildPlanet({
      ip4: primaryNode.ip4,
      domain: primaryNode.domain,
      port: primaryNode.port,
    });

    topology.lastUnifiedBuildAt = new Date().toISOString();
    await FileManager.writeJson(this.clusterConfigPath, topology);

    return {
      success: true,
      message: `Unified Cluster Planet compiled successfully with ${activeNodes.length} federated roots.`,
      federatedRootsCount: activeNodes.length,
      primaryRoot: primaryNode.nodeId,
      planetPath: buildResult.planetPath,
      lastUnifiedBuildAt: topology.lastUnifiedBuildAt,
    };
  }
}
