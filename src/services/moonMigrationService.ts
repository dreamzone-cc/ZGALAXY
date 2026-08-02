import path from 'path';
import { config } from '../engine/config';
import { FileManager } from './fileManager';
import { MoonService } from './moonService';
import { ClusterService } from './clusterService';

export interface MoonMigrationResult {
  success: boolean;
  moonId: string;
  previousPlanetId?: string;
  targetPlanetId: string;
  updatedEndpoints: string[];
  moonFileName: string;
  migratedAt: string;
}

export class MoonMigrationService {
  public static async migrateMoon(moonId: string, targetPlanetId: string): Promise<MoonMigrationResult> {
    const cluster = await ClusterService.getClusterTopology();
    const targetNode = cluster.nodes.find((n) => n.nodeId === targetPlanetId || n.ip4 === targetPlanetId);

    if (!targetNode) {
      throw new Error(`Target Planet node [${targetPlanetId}] not found in federated cluster.`);
    }

    const targetEndpoint = targetNode.domain
      ? `${targetNode.domain}/${targetNode.port}`
      : `${targetNode.ip4}/${targetNode.port}`;

    // Re-bind Moon to target Planet endpoint
    const createRes = await MoonService.createMoon({
      name: moonId,
      endpoints: [targetEndpoint],
    });

    return {
      success: true,
      moonId,
      targetPlanetId: targetNode.nodeId,
      updatedEndpoints: [targetEndpoint],
      moonFileName: createRes.moonFileName,
      migratedAt: new Date().toISOString(),
    };
  }

  public static async rebindMoonEndpoints(moonId: string, endpoints: string[]): Promise<any> {
    if (!endpoints || endpoints.length === 0) {
      throw new Error('Endpoints array cannot be empty for Moon re-binding.');
    }

    const updateRes = await MoonService.updateMoon(moonId, endpoints);
    return {
      success: true,
      moonId,
      endpoints,
      moonFileName: updateRes.moonFileName,
      reboundAt: new Date().toISOString(),
    };
  }
}
