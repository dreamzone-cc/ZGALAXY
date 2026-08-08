import path from 'path';
import { config } from '../engine/config';
import { CliService } from './cliService';
import { FileManager } from './fileManager';
import { buildMutex } from './mutex';

export interface CreateMoonRequest {
  name: string;
  endpoints: string[];
}

export class MoonService {
  public static async getIdToolCmd(): Promise<string> {
    const localIdTool = path.join(config.appPath, 'zerotier-idtool');
    const ztVarIdTool = path.join(config.ztVarPath, 'zerotier-idtool');
    const hasLocalIdTool = await FileManager.fileExists(localIdTool);
    const hasZtVarIdTool = await FileManager.fileExists(ztVarIdTool);

    if (hasLocalIdTool) return localIdTool;
    if (hasZtVarIdTool) return ztVarIdTool;
    return 'zerotier-idtool';
  }

  public static async listMoons(): Promise<any[]> {
    const files = await FileManager.listFiles(config.distPath);
    const moonFiles = files.filter((f) => f.endsWith('.moon'));
    
    return moonFiles.map((f) => ({
      id: f.replace('.moon', ''),
      fileName: f,
      downloadUrl: `/api/v1/moons/${f}/download`,
      filePath: path.join(config.distPath, f),
      status: 'ACTIVE',
    }));
  }

  public static async createMoon(req: CreateMoonRequest): Promise<any> {
    return buildMutex.run(() => this.createMoonInner(req));
  }

  private static async createMoonInner(req: CreateMoonRequest): Promise<any> {
    if (!req.endpoints || !Array.isArray(req.endpoints) || req.endpoints.length === 0) {
      throw new Error('Endpoints array cannot be empty for Moon creation.');
    }
    for (const ep of req.endpoints) {
      if (typeof ep !== 'string' || !ep.trim() || ep.length > 512) {
        throw new Error(`Invalid Moon endpoint: '${ep}'.`);
      }
    }

    const moonJsonPath = path.join(config.ztVarPath, 'moon.json');
    const idPubKeyPath = path.join(config.ztVarPath, 'identity.public');
    const idToolCmd = await this.getIdToolCmd();

    // Ensure identity.public exists
    if (!(await FileManager.fileExists(idPubKeyPath))) {
      await CliService.executeCommandArray(idToolCmd, ['generate', 'identity.secret', 'identity.public'], config.ztVarPath);
    }

    // Auto-initialize moon.json with valid keys if missing or uninitialized
    let needsInit = false;
    if (!(await FileManager.fileExists(moonJsonPath))) {
      needsInit = true;
    } else {
      try {
      const currentData = await FileManager.readJson(moonJsonPath);
      if (!currentData.signingKey || !(currentData.signingKey_secret || currentData.signingKey_SECRET)) {
        needsInit = true;
      }
      } catch {
        needsInit = true;
      }
    }

    if (needsInit) {
      const initResult = await CliService.executeCommandArray(idToolCmd, ['initmoon', 'identity.public'], config.ztVarPath);
      await FileManager.writeText(moonJsonPath, initResult.stdout || initResult.stderr);
    }

    const moonData = await FileManager.readJson(moonJsonPath);
    if (moonData.roots && moonData.roots.length > 0) {
      moonData.roots[0].stableEndpoints = req.endpoints;
    } else {
      moonData.roots = [{ id: moonData.id, stableEndpoints: req.endpoints }];
    }

    await FileManager.writeJson(moonJsonPath, moonData);
    await CliService.executeCommandArray(idToolCmd, ['genmoon', 'moon.json'], config.ztVarPath);

    // Deterministic selection: the generated file is named by the moon's
    // WORLD id formatted as 16 hex chars (a uint64), NOT the raw "id" string.
    // genmoon emits e.g. "000000069ae38092.moon" for a world id 069ae38092.
    const worldIdHex = BigInt('0x' + String(moonData.id)).toString(16).padStart(16, '0');
    const generatedMoon = `${worldIdHex}.moon`;
    const srcMoon = path.join(config.ztVarPath, generatedMoon);

    if (await FileManager.fileExists(srcMoon)) {
      const destMoon = path.join(config.distPath, generatedMoon);
      await FileManager.copyFile(srcMoon, destMoon);

      return {
        success: true,
        moonFileName: generatedMoon,
        downloadUrl: `/api/v1/moons/${generatedMoon}/download`,
      };
    }

    throw new Error(`Failed to locate generated .moon file (expected ${generatedMoon}).`);
  }

  public static async updateMoon(moonId: string, endpoints: string[]): Promise<any> {
    return buildMutex.run(async () => {
      const moonJsonPath = path.join(config.ztVarPath, 'moon.json');
      const moonData = await FileManager.readJson(moonJsonPath);
      if (moonId !== moonData.id && `${moonId}.moon` !== `${moonData.id}.moon`) {
        throw new Error(`Moon '${moonId}' does not match the configured moon identity.`);
      }
      return await this.createMoonInner({ name: moonId, endpoints });
    });
  }

  public static async rebuildMoon(moonId: string): Promise<any> {
    return buildMutex.run(async () => {
      const moonJsonPath = path.join(config.ztVarPath, 'moon.json');
      const moonData = await FileManager.readJson(moonJsonPath);
      if (moonId !== moonData.id && `${moonId}.moon` !== `${moonData.id}.moon`) {
        throw new Error(`Moon '${moonId}' does not match the configured moon identity.`);
      }
      const idToolCmd = await this.getIdToolCmd();
      await CliService.executeCommandArray(idToolCmd, ['genmoon', 'moon.json'], config.ztVarPath);

      // Refresh the dist copy so download never serves a stale artifact.
      const generatedMoon = `${moonData.id}.moon`;
      const srcMoon = path.join(config.ztVarPath, generatedMoon);
      if (await FileManager.fileExists(srcMoon)) {
        await FileManager.copyFile(srcMoon, path.join(config.distPath, generatedMoon));
      }
      return { success: true, message: `Moon ${moonId} rebuilt successfully.` };
    });
  }

  /**
   * Resolve a moon id to a safe absolute path within config.distPath.
   * Rejects path traversal (.., absolute paths, separators, hidden files).
   */
  private static resolveMoonFile(moonId: string): string {
    const base = moonId.endsWith('.moon') ? moonId : `${moonId}.moon`;
    const name = path.basename(base);
    if (
      name !== base ||
      !name.endsWith('.moon') ||
      name.startsWith('.') ||
      name.includes('/') ||
      name.includes('\\') ||
      !/^[A-Za-z0-9._-]+\.moon$/.test(name)
    ) {
      throw new Error(`Invalid Moon identifier: ${moonId}`);
    }
    const resolved = path.resolve(config.distPath, name);
    if (!resolved.startsWith(path.resolve(config.distPath) + path.sep)) {
      throw new Error(`Invalid Moon identifier: ${moonId}`);
    }
    return resolved;
  }

  public static async deleteMoon(moonId: string): Promise<any> {
    const filePath = this.resolveMoonFile(moonId);

    if (await FileManager.fileExists(filePath)) {
      const fs = require('fs/promises');
      await fs.unlink(filePath);
      return { success: true, message: `Moon ${path.basename(filePath)} deleted.` };
    }

    throw new Error(`Moon file ${path.basename(filePath)} does not exist.`);
  }

  public static async getMoonFilePath(moonId: string): Promise<string> {
    const filePath = this.resolveMoonFile(moonId);

    if (await FileManager.fileExists(filePath)) {
      return filePath;
    }
    throw new Error(`Moon file ${path.basename(filePath)} not found.`);
  }

  public static getHATemplates(): any {
    return {
      multiRegion: {
        description: 'Cluster of 3 Moons across US, EU, and Asia for zero latency relay',
        replication: 'Full mesh',
      },
      failoverPair: {
        description: 'Primary and Secondary Moon with automatic failover endpoints',
        replication: 'Active-Passive',
      },
    };
  }
}
