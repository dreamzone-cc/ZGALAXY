import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30_000;

export class CliService {
  /**
   * Execute a command without a shell (execFile semantics), preventing shell
   * command injection via interpolated arguments. Preferred over shell exec.
   */
  public static async executeCommandArray(
    program: string,
    args: string[],
    cwd?: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const result = await execFileAsync(program, args, {
        cwd,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 4 * 1024 * 1024,
      });
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error: any) {
      const kind = error.killed || error.code === 'ERR_CHILD_PROCESS_KILL_TIMEOUT' ? 'timed out' : 'failed';
      throw new Error(`Command ${kind} [${program} ${args.join(' ')}]: ${error.stderr || error.message}`);
    }
  }

  /**
   * Execute a binary with execFile semantics (no shell). Retained for callers
   * that already pass an absolute binary path.
   */
  public static async executeBinary(
    binaryPath: string,
    args: string[],
    cwd?: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<{ stdout: string; stderr: string }> {
    return this.executeCommandArray(binaryPath, args, cwd, timeoutMs);
  }
}
