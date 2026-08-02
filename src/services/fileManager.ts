import fs from 'fs/promises';
import existsSync from 'fs';
import path from 'path';

export class FileManager {
  public static async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  public static async readText(filePath: string): Promise<string> {
    return await fs.readFile(filePath, 'utf-8');
  }

  public static async writeText(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  public static async readJson<T = any>(filePath: string): Promise<T> {
    const text = await this.readText(filePath);
    return JSON.parse(text);
  }

  public static async writeJson(filePath: string, data: any): Promise<void> {
    await this.writeText(filePath, JSON.stringify(data, null, 2));
  }

  public static async copyFile(src: string, dest: string): Promise<void> {
    const dir = path.dirname(dest);
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(src, dest);
  }

  public static async listFiles(dirPath: string): Promise<string[]> {
    try {
      return await fs.readdir(dirPath);
    } catch {
      return [];
    }
  }
}
