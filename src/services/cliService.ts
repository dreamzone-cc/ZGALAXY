import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export class CliService {
  public static async executeCommand(command: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
    try {
      const result = await execAsync(command, { cwd });
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error: any) {
      throw new Error(`Command failed [${command}]: ${error.message}`);
    }
  }

  public static async executeBinary(binaryPath: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
    try {
      const result = await execFileAsync(binaryPath, args, { cwd });
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error: any) {
      throw new Error(`Binary execution failed [${binaryPath} ${args.join(' ')}]: ${error.message}`);
    }
  }
}
