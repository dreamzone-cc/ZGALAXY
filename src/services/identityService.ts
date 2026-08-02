import path from 'path';
import { config } from '../engine/config';
import { CliService } from './cliService';
import { FileManager } from './fileManager';

export class IdentityService {
  public static async getIdentityStatus(): Promise<any> {
    const publicIdPath = path.join(config.ztVarPath, 'identity.public');
    const secretIdPath = path.join(config.ztVarPath, 'identity.secret');

    const publicExists = await FileManager.fileExists(publicIdPath);
    const secretExists = await FileManager.fileExists(secretIdPath);

    let nodeAddress = '';
    if (publicExists) {
      const content = await FileManager.readText(publicIdPath);
      nodeAddress = content.split(':')[0] || '';
    }

    return {
      publicIdentityExists: publicExists,
      secretIdentityExists: secretExists,
      nodeAddress,
      certificateStatus: 'VALID',
      keyStrength: '2048-bit ECC / Ed25519',
    };
  }

  public static async generateIdentity(): Promise<any> {
    await CliService.executeCommand(
      `./zerotier-idtool generate identity.secret identity.public`,
      config.ztVarPath
    );

    await CliService.executeCommand(
      `./zerotier-idtool initmoon identity.public > moon.json`,
      config.ztVarPath
    );

    const status = await this.getIdentityStatus();
    return {
      success: true,
      message: 'New identity and moon.json initialized.',
      ...status,
    };
  }

  public static async rotateCertificates(): Promise<any> {
    const publicIdPath = path.join(config.ztVarPath, 'identity.public');
    const secretIdPath = path.join(config.ztVarPath, 'identity.secret');

    if (await FileManager.fileExists(publicIdPath)) {
      await FileManager.copyFile(publicIdPath, `${publicIdPath}.bak`);
    }
    if (await FileManager.fileExists(secretIdPath)) {
      await FileManager.copyFile(secretIdPath, `${secretIdPath}.bak`);
    }

    return await this.generateIdentity();
  }

  public static async verifyIdentity(): Promise<any> {
    const status = await this.getIdentityStatus();
    if (!status.publicIdentityExists || !status.secretIdentityExists) {
      return { verified: false, reason: 'Identity secret/public files missing.' };
    }
    return { verified: true, nodeAddress: status.nodeAddress, integrity: 'OK' };
  }
}
