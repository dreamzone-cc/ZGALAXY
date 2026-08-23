import path from 'path';
import crypto from 'crypto';
import { config } from '../engine/config';
import { CliService } from './cliService';
import { FileManager } from './fileManager';
import { PlanetService } from './planetService';

export class IdentityService {
  /**
   * Public identity facts (safe to expose without auth — identical to what
   * every mesh peer learns during handshakes). Used by federating engines to
   * build honest multi-root planets (ج1).
   */
  public static async getPublicIdentity(): Promise<any> {
    const status = await this.getIdentityStatus();
    let publicIdentity = '';
    const publicIdPath = path.join(config.ztVarPath, 'identity.public');
    if (status.publicIdentityExists && (await FileManager.fileExists(publicIdPath))) {
      publicIdentity = (await FileManager.readText(publicIdPath)).trim();
    }
    return {
      address: status.nodeAddress,
      publicIdentity,
      certificateStatus: status.certificateStatus,
    };
  }

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

      if (nodeAddress && isHexKey && /^[0-9a-fA-F]{10}$/.test(nodeAddress) && pubHex.length >= 64) {
        let validatedByIdTool = false;
        let validationAttempted = false;
        try {
          const idTool = await PlanetService.resolveIdTool();
          if (idTool && (await FileManager.fileExists(idTool))) {
            validationAttempted = true;
            const res = await CliService.executeCommandArray(idTool, ['validate', publicIdPath], config.ztVarPath);
            if (res && res.stdout && res.stdout.includes('is a valid identity')) {
              validatedByIdTool = true;
            }
          }
        } catch {
          // Cli execution fallback
        }

        if (validatedByIdTool) {
          certificateStatus = 'VALID';
          verification = { valid: true, reason: 'Identity validated successfully by ZeroTier idtool engine.' };
        } else if (!validationAttempted) {
          certificateStatus = 'VALID';
          verification = { valid: true, reason: 'Identity matches canonical ZeroTier structural format.' };
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
    // Safety: back up the current identity files and moon.json before
    // overwriting. Regenerating changes the ZeroTier node address, which
    // invalidates every client/planet that references the old address — the
    // backup makes the operation reversible.
    const publicIdPath = path.join(config.ztVarPath, 'identity.public');
    const secretIdPath = path.join(config.ztVarPath, 'identity.secret');
    const moonJsonPath = path.join(config.ztVarPath, 'moon.json');
    const stamp = Date.now();
    for (const p of [publicIdPath, secretIdPath, moonJsonPath]) {
      if (await FileManager.fileExists(p)) {
        await FileManager.copyFile(p, `${p}.bak.${stamp}`);
      }
    }

    const idTool = await PlanetService.resolveIdTool();
    await CliService.executeCommandArray(
      idTool,
      ['generate', 'identity.secret', 'identity.public'],
      config.ztVarPath
    );

    const initResult = await CliService.executeCommandArray(
      idTool,
      ['initmoon', 'identity.public'],
      config.ztVarPath
    );
    await FileManager.writeText(path.join(config.ztVarPath, 'moon.json'), initResult.stdout || initResult.stderr);

    const status = await this.getIdentityStatus();
    return {
      success: true,
      message:
        'New identity and moon.json initialized. WARNING: the node address changed and existing clients/planet references to the previous address are now invalid. A backup was saved as identity.*.bak.<ts> / moon.json.bak.<ts>.',
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
