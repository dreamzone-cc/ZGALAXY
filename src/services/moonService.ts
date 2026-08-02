import path from 'path';
import { config } from '../engine/config';
import { CliService } from './cliService';
import { FileManager } from './fileManager';

export interface CreateMoonRequest {
  name: string;
  endpoints: string[];
}

export class MoonService {
  private static async getIdToolCmd(): Promise<string> {
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
    if (!req.endpoints || req.endpoints.length === 0) {
      throw new Error('Endpoints array cannot be empty for Moon creation.');
    }

    const moonJsonPath = path.join(config.ztVarPath, 'moon.json');
    const idPubKeyPath = path.join(config.ztVarPath, 'identity.public');
    const idToolCmd = await this.getIdToolCmd();

    // Ensure identity.public exists
    if (!(await FileManager.fileExists(idPubKeyPath))) {
      await CliService.executeCommand(`${idToolCmd} generate identity.secret identity.public`, config.ztVarPath);
    }

    // Auto-initialize moon.json with valid keys if missing or uninitialized
    let needsInit = false;
    if (!(await FileManager.fileExists(moonJsonPath))) {
      needsInit = true;
    } else {
      try {
        const currentData = await FileManager.readJson(moonJsonPath);
        if (!currentData.signingKey || !currentData.signingKey_secret) {
          needsInit = true;
        }
      } catch {
        needsInit = true;
      }
    }

    if (needsInit) {
      await CliService.executeCommand(`${idToolCmd} initmoon identity.public > moon.json`, config.ztVarPath);
    }

    const moonData = await FileManager.readJson(moonJsonPath);
    if (moonData.roots && moonData.roots.length > 0) {
      moonData.roots[0].stableEndpoints = req.endpoints;
    } else {
      moonData.roots = [{ id: moonData.id, stableEndpoints: req.endpoints }];
    }

    await FileManager.writeJson(moonJsonPath, moonData);
    await CliService.executeCommand(`${idToolCmd} genmoon moon.json`, config.ztVarPath);

    const files = await FileManager.listFiles(config.ztVarPath);
    const generatedMoon = files.find((f) => f.endsWith('.moon'));

    if (generatedMoon) {
      const srcMoon = path.join(config.ztVarPath, generatedMoon);
      const destMoon = path.join(config.distPath, generatedMoon);
      await FileManager.copyFile(srcMoon, destMoon);

      return {
        success: true,
        moonFileName: generatedMoon,
        downloadUrl: `/api/v1/moons/${generatedMoon}/download`,
      };
    }

    throw new Error('Failed to locate generated .moon file.');
  }

  public static async updateMoon(moonId: string, endpoints: string[]): Promise<any> {
    return await this.createMoon({ name: moonId, endpoints });
  }

  public static async rebuildMoon(moonId: string): Promise<any> {
    const moonJsonPath = path.join(config.ztVarPath, 'moon.json');
    const idToolCmd = await this.getIdToolCmd();
    await CliService.executeCommand(`${idToolCmd} genmoon moon.json`, config.ztVarPath);
    return { success: true, message: `Moon ${moonId} rebuilt successfully.` };
  }

  public static async deleteMoon(moonId: string): Promise<any> {
    const fileName = moonId.endsWith('.moon') ? moonId : `${moonId}.moon`;
    const filePath = path.join(config.distPath, fileName);

    if (await FileManager.fileExists(filePath)) {
      const fs = require('fs/promises');
      await fs.unlink(filePath);
      return { success: true, message: `Moon ${fileName} deleted.` };
    }

    throw new Error(`Moon file ${fileName} does not exist.`);
  }

  public static async getMoonFilePath(moonId: string): Promise<string> {
    const fileName = moonId.endsWith('.moon') ? moonId : `${moonId}.moon`;
    const filePath = path.join(config.distPath, fileName);

    if (await FileManager.fileExists(filePath)) {
      return filePath;
    }
    throw new Error(`Moon file ${fileName} not found.`);
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
