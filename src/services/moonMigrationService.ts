import path from 'path';
import { config } from '../engine/config';
import { FileManager } from './fileManager';
import { MoonService } from './moonService';
import { CliService } from './cliService';
import { ClusterService } from './clusterService';
import { buildMutex } from './mutex';

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
  /**
   * Real migration: preserve the moon's identity (signing keys) and simply
   * re-point its stable endpoints to the target planet, then re-sign (genmoon).
   * The original .moon artifact is removed after success. This is NOT a fresh
   * identity regeneration (which would break existing clients — M17/M15).
   */
  public static async migrateMoon(moonId: string, targetPlanetId: string): Promise<MoonMigrationResult> {
    return buildMutex.run(async () => {
      const cleanId = moonId.endsWith('.moon') ? moonId.slice(0, -5) : moonId;
      if (!/^[A-Za-z0-9_.-]+$/.test(cleanId)) {
        throw new Error(`Invalid Moon identifier: ${moonId}`);
      }

      const cluster = await ClusterService.getClusterTopology();
      const targetNode = (cluster.nodes || []).find(
        (n: any) => n.nodeId === targetPlanetId || n.ip4 === targetPlanetId || n.domain === targetPlanetId
      );

      if (!targetNode) {
        throw new Error(`Target Planet node [${targetPlanetId}] not found in federated cluster.`);
      }

      const port = targetNode.port || config.ztPort;
      const targetEndpoint = targetNode.domain ? `${targetNode.domain}/${port}` : `${targetNode.ip4}/${port}`;

      const moonJsonPath = path.join(config.ztVarPath, 'moon.json');
      if (!(await FileManager.fileExists(moonJsonPath))) {
        throw new Error('moon.json not found; create a Moon first before migrating.');
      }

      const moonData = await FileManager.readJson(moonJsonPath);
      if (!moonData.id || !moonData.signingKey || !(moonData.signingKey_secret || moonData.signingKey_SECRET)) {
        throw new Error('moon.json is missing its identity/signing keys; create a fresh Moon first.');
      }
      if (cleanId !== moonData.id) {
        throw new Error(`Moon '${cleanId}' does not match the configured moon identity '${moonData.id}'.`);
      }

      // Preserve identity; record the previous binding.
      const previousRoot = moonData.roots && moonData.roots[0] && moonData.roots[0].stableEndpoints;
      const previousPlanetId = this.resolvePlanetId(cluster.nodes || [], previousRoot);

      if (!moonData.roots || moonData.roots.length === 0) {
        moonData.roots = [{ id: moonData.id, stableEndpoints: [targetEndpoint] }];
      } else {
        moonData.roots[0].stableEndpoints = [targetEndpoint];
      }

      // Snapshot before mutation so we can roll back if genmoon fails.
      const backup = JSON.stringify(moonData);
      await FileManager.writeJson(moonJsonPath, moonData);

      try {
        const idToolCmd = await MoonService.getIdToolCmd();
        await CliService.executeCommandArray(idToolCmd, ['genmoon', 'moon.json'], config.ztVarPath);

        const newMoonFileName = `${moonData.id}.moon`;
        const srcMoon = path.join(config.ztVarPath, newMoonFileName);
        if (!(await FileManager.fileExists(srcMoon))) {
          throw new Error('genmoon did not produce the migrated .moon file.');
        }

        const destMoon = path.join(config.distPath, newMoonFileName);
        await FileManager.copyFile(srcMoon, destMoon);

        // Remove the original artifact for this moon id from dist, if it differs.
        const oldFileName = `${cleanId}.moon`;
        if (oldFileName !== newMoonFileName) {
          const oldPath = path.join(config.distPath, oldFileName);
          if (await FileManager.fileExists(oldPath)) {
            const fs = require('fs/promises');
            await fs.unlink(oldPath);
          }
        }
      } catch (err) {
        // Roll back moon.json so the signed artifact and config never diverge.
        await FileManager.writeText(moonJsonPath, backup);
        throw err;
      }

      return {
        success: true,
        moonId: cleanId,
        previousPlanetId,
        targetPlanetId: targetNode.nodeId,
        updatedEndpoints: [targetEndpoint],
        moonFileName: `${moonData.id}.moon`,
        migratedAt: new Date().toISOString(),
      };
    });
  }

  private static resolvePlanetId(nodes: any[], oldEndpoints: string[] | undefined): string | undefined {
    if (!oldEndpoints || oldEndpoints.length === 0) return undefined;
    let target = oldEndpoints[0].split('/')[0];
    // Strip brackets from IPv6 literals ([::1] -> ::1) before comparison.
    if (target.startsWith('[') && target.endsWith(']')) target = target.slice(1, -1);
    const match = nodes.find(
      (n: any) => n.domain === target || n.ip4 === target || n.ip6 === target
    );
    return match ? match.nodeId : undefined;
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
