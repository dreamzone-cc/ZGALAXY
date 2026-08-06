import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { pipeline } from 'node:stream/promises';
import { config } from '../engine/config';
import { FileManager } from './fileManager';
import { CliService } from './cliService';

const MAGIC = Buffer.from('ZGAL');
const VERSION = 0x01;
// Header: MAGIC(4) + VERSION(1) + IV(12) + TAG(16) = 33 bytes.
const HEADER_LEN = 33;
const TAG_OFFSET = 17;

function deriveKey(): Buffer {
  const passphrase = process.env.BACKUP_PASSPHRASE || config.secretKey;
  return crypto.createHash('sha256').update(passphrase).digest();
}

export class BackupService {
  public static async exportBackup(): Promise<any> {
    const backupDir = config.ztVarPath;
    const archivePath = path.join(config.configPath, 'zerotier_backup.tar.gz');

    if (!(await FileManager.fileExists(backupDir))) {
      throw new Error(`ZeroTier data directory does not exist at ${backupDir}`);
    }

    if (!process.env.BACKUP_PASSPHRASE) {
      console.warn(
        '[ZGALAXY BACKUP] BACKUP_PASSPHRASE is not set; encryption key is derived from SECRET_KEY. ' +
          'Set BACKUP_PASSPHRASE for an independent backup key.'
      );
    }

    // --warning=no-file-changed tolerates live files changing mid-archive.
    await CliService.executeCommandArray(
      'tar',
      ['--warning=no-file-changed', '-czf', archivePath, '-C', backupDir, '.'],
      undefined,
      60_000
    );

    const encryptedPath = `${archivePath}.enc`;
    try {
      await this.streamEncrypt(archivePath, encryptedPath);
      const checksum = crypto.createHash('sha256').update(await fs.promises.readFile(archivePath)).digest('hex');
      return {
        success: true,
        encrypted: true,
        cipher: 'AES-256-GCM',
        backupPath: encryptedPath,
        checksumSha256: checksum,
        exportedAt: new Date().toISOString(),
      };
    } finally {
      // Always remove the plaintext intermediate, even on failure/crash paths.
      await fs.promises.unlink(archivePath).catch(() => {});
    }
  }

  public static async importBackup(tarPath: string): Promise<any> {
    if (!tarPath) {
      throw new Error('Backup file path is required.');
    }
    const resolvedTar = path.resolve(tarPath);
    if (!(await FileManager.fileExists(resolvedTar))) {
      throw new Error(`Backup file not found at ${resolvedTar}`);
    }

    let decrypted = false;
    const tmpArchive = path.join(config.configPath, `.backup_restore_${process.pid}_${Date.now()}.tar.gz`);

    try {
      const header = Buffer.alloc(HEADER_LEN);
      const fh = await fs.promises.open(resolvedTar, 'r');
      try {
        const { bytesRead } = await fh.read(header, 0, HEADER_LEN, 0);
        if (bytesRead === HEADER_LEN && header.subarray(0, 4).equals(MAGIC)) {
          // Encrypted (or legacy JSON) format.
          if (header[4] !== VERSION) {
            throw new Error(`Unsupported encrypted backup version: ${header[4]}`);
          }
          await this.streamDecrypt(resolvedTar, header, tmpArchive);
          decrypted = true;
        } else {
          // Legacy plaintext archive support.
          await fs.promises.copyFile(resolvedTar, tmpArchive);
        }
      } finally {
        await fh.close();
      }

      // Validate gzip magic before extracting.
      const gz = Buffer.alloc(2);
      const fh2 = await fs.promises.open(tmpArchive, 'r');
      try {
        await fh2.read(gz, 0, 2, 0);
      } finally {
        await fh2.close();
      }
      if (gz[0] !== 0x1f || gz[1] !== 0x8b) {
        throw new Error('Backup file is not a valid gzip archive.');
      }

      const backupDir = config.ztVarPath;
      await CliService.executeCommandArray(
        'tar',
        ['--no-same-owner', '--no-same-permissions', '-xzf', tmpArchive, '-C', backupDir],
        undefined,
        60_000
      );

      const checksum = crypto.createHash('sha256').update(await fs.promises.readFile(tmpArchive)).digest('hex');
      return {
        success: true,
        message: 'Infrastructure restored successfully from backup.',
        encrypted: decrypted,
        checksumSha256: checksum,
      };
    } finally {
      await fs.promises.unlink(tmpArchive).catch(() => {});
    }
  }

  /** Stream a plaintext tar into an encrypted file (constant memory). */
  private static async streamEncrypt(srcPath: string, destPath: string): Promise<void> {
    const key = deriveKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const header = Buffer.alloc(HEADER_LEN);
    MAGIC.copy(header, 0);
    header[4] = VERSION;
    iv.copy(header, 5);

    // Write the header first, then stream the ciphertext in append mode.
    await fs.promises.writeFile(destPath, header, { mode: 0o600 });
    const out = await fs.promises.open(destPath, 'a');
    try {
      await pipeline(fs.createReadStream(srcPath), cipher, out.createWriteStream());
    } finally {
      await out.close();
    }
    // Patch the auth tag into the reserved header slot (offset 17).
    const tag = cipher.getAuthTag();
    const fh = await fs.promises.open(destPath, 'r+');
    try {
      await fh.write(tag, 0, tag.length, TAG_OFFSET);
    } finally {
      await fh.close();
    }
  }

  /** Stream an encrypted file back to plaintext (constant memory). */
  private static async streamDecrypt(srcPath: string, header: Buffer, destPath: string): Promise<void> {
    const key = deriveKey();
    const iv = header.subarray(5, 17);
    const tag = header.subarray(17, 33);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const out = await fs.promises.open(destPath, 'w', 0o600);
    try {
      await pipeline(fs.createReadStream(srcPath, { start: HEADER_LEN }), decipher, out.createWriteStream());
    } finally {
      await out.close();
    }
  }
}
