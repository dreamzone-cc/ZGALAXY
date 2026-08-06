import path from 'path';
import crypto from 'crypto';
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
    let keyStrength = '';
    let certificateStatus = 'NOT_PRESENT';
    let verification = { valid: false, reason: 'Identity files missing.' };

    if (publicExists && secretExists) {
      const content = await FileManager.readText(publicIdPath);
      const parts = content.split(':');
      nodeAddress = parts[0] || '';

      // ZeroTier identity.public format: <address>:<legacy(0)>:<pubkey-hex>.
      // The middle field is a legacy placeholder ('0') and must be skipped.
      const pubHex = parts.length >= 3 ? parts[2] : parts.length === 2 ? parts[1] : '';
      const pubBytes = pubHex ? Buffer.from(pubHex, 'hex') : Buffer.alloc(0);
      const isHexKey = pubBytes.length > 0 && /^[0-9a-fA-F]+$/.test(pubHex);

      if (isHexKey) {
        keyStrength = `${pubBytes.length * 8}-bit Ed25519/Curve25519`;
      } else {
        keyStrength = 'UNKNOWN (public key unparsable)';
      }

      if (nodeAddress && isHexKey) {
        const expectedAddress = crypto
          .createHash('sha384')
          .update(pubBytes)
          .digest('hex')
          .substring(0, 10);
        if (expectedAddress === nodeAddress.toLowerCase()) {
          certificateStatus = 'VALID';
          verification = { valid: true, reason: 'Identity key matches the derived ZeroTier address.' };
        } else {
          certificateStatus = 'MISMATCH';
          verification = { valid: false, reason: 'Public key does not derive the stored node address.' };
        }
      } else {
        certificateStatus = 'INVALID';
        verification = { valid: false, reason: 'Identity.public is malformed.' };
      }
    } else {
      verification = {
        valid: false,
        reason: publicExists ? 'secret identity missing' : 'public identity missing',
      };
    }

    return {
      publicIdentityExists: publicExists,
      secretIdentityExists: secretExists,
      nodeAddress,
      certificateStatus,
      keyStrength,
      verification,
    };
  }

  public static async generateIdentity(): Promise<any> {
    await CliService.executeCommandArray(
      './zerotier-idtool',
      ['generate', 'identity.secret', 'identity.public'],
      config.ztVarPath
    );

    const initResult = await CliService.executeCommandArray(
      './zerotier-idtool',
      ['initmoon', 'identity.public'],
      config.ztVarPath
    );
    await FileManager.writeText(path.join(config.ztVarPath, 'moon.json'), initResult.stdout || initResult.stderr);

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
    return {
      verified: status.verification.valid,
      nodeAddress: status.nodeAddress,
      certificateStatus: status.certificateStatus,
      keyStrength: status.keyStrength,
      reason: status.verification.reason,
    };
  }
}
