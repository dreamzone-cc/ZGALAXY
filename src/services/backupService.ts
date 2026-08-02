import path from 'path';
import { config } from '../engine/config';
import { FileManager } from './fileManager';
import { CliService } from './cliService';

export class BackupService {
  public static async exportBackup(): Promise<any> {
    const backupDir = config.ztVarPath;
    const archivePath = path.join(config.configPath, 'zerotier_backup.tar.gz');
    
    // Ensure target directory exists before running tar
    if (!(await FileManager.fileExists(backupDir))) {
      throw new Error(`ZeroTier data directory does not exist at ${backupDir}`);
    }

    await CliService.executeCommand(`tar -czf ${archivePath} -C ${backupDir} .`);

    return {
      success: true,
      backupPath: archivePath,
      exportedAt: new Date().toISOString(),
    };
  }

  public static async importBackup(tarPath: string): Promise<any> {
    if (!(await FileManager.fileExists(tarPath))) {
      throw new Error(`Backup file not found at ${tarPath}`);
    }

    const backupDir = config.ztVarPath;
    await CliService.executeCommand(`tar -xzf ${tarPath} -C ${backupDir}`);
    return {
      success: true,
      message: 'Infrastructure restored successfully from backup.',
    };
  }
}
