import fs from 'fs/promises';
import path from 'path';

// In-process per-path write queue: serializes concurrent writes to the same file
// to prevent torn/interleaved writes (addresses M14 — no file locks).
const writeQueues = new Map<string, Promise<void>>();

function enqueueWrite(filePath: string, task: () => Promise<void>): Promise<void> {
  const key = path.resolve(filePath);
  const prev = writeQueues.get(key) || Promise.resolve();
  const next = prev.then(task, task);
  const stored = next.catch(() => {});
  writeQueues.set(key, stored);
  stored.finally(() => {
    if (writeQueues.get(key) === stored) {
      writeQueues.delete(key);
    }
  });
  return next;
}

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
    await enqueueWrite(filePath, () => this.writeTextInner(filePath, content));
  }

  private static async writeTextInner(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    // Atomic write: temp file + rename so readers never observe a partial file.
    const tmp = `${filePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
    const fh = await fs.open(tmp, 'w', 0o600);
    try {
      await fh.writeFile(content, 'utf-8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.rename(tmp, filePath);
  }

  public static async readJson<T = any>(filePath: string): Promise<T> {
    const text = await this.readText(filePath);
    return JSON.parse(text);
  }

  public static async writeJson(filePath: string, data: any): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    await this.writeText(filePath, content);
  }

  /** Atomic copy (tmp + rename) so a reader never serves a truncated file. */
  public static async copyFile(src: string, dest: string): Promise<void> {
    const dir = path.dirname(dest);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${dest}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
    await fs.copyFile(src, tmp);
    await fs.rename(tmp, dest);
  }

  public static async listFiles(dirPath: string): Promise<string[]> {
    try {
      return await fs.readdir(dirPath);
    } catch {
      return [];
    }
  }
}
