import { spawn, type ChildProcess } from 'node:child_process';

export interface RunProcessOptions {
  timeoutMs?: number;
  cwd?: string;
  maxOutputBytes?: number;
}

export interface ProcessResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  code: number;
}

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly result: ProcessResult,
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}

const activeChildren = new Set<ChildProcess>();

export function terminateAllProcesses(): void {
  for (const child of activeChildren) {
    killTree(child);
  }

  activeChildren.clear();
}

function killTree(child: ChildProcess): void {
  if (!child.pid) {
    child.kill('SIGKILL');
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', () => child.kill());
    return;
  }

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

export async function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions = {},
): Promise<ProcessResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxOutputBytes = options.maxOutputBytes ?? 2 * 1024 * 1024;
  const startedAt = Date.now();

  return new Promise<ProcessResult>((resolve, reject) => {
    let child: ChildProcess;

    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(
        new ProcessError(
          `Gagal menjalankan ${command}: ${error instanceof Error ? error.message : String(error)}`,
          { command, args, stdout: '', stderr: '', code: -1 },
        ),
      );
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    activeChildren.add(child);

    const result = (code: number): ProcessResult => ({
      command,
      args,
      stdout,
      stderr,
      code,
    });

    const finishReject = (message: string, code = -1): void => {
      if (settled) {
        return;
      }

      settled = true;

      if (timer) {
        clearTimeout(timer);
      }

      reject(new ProcessError(message, result(code)));
    };

    const append = (current: string, chunk: Buffer): string => {
      if (current.length >= maxOutputBytes) {
        return current;
      }

      return (current + chunk.toString('utf8')).slice(0, maxOutputBytes);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    child.once('error', (error) => {
      activeChildren.delete(child);
      finishReject(`Gagal menjalankan ${command}: ${error.message}`);
    });

    timer = setTimeout(() => {
      timedOut = true;
      killTree(child);

      // Give the process a moment to close, then reject if it is stuck.
      setTimeout(() => {
        finishReject(
          `${command} timeout setelah ${Math.round((Date.now() - startedAt) / 1000)} detik`,
        );
      }, 5_000).unref();
    }, timeoutMs);

    timer.unref();

    child.once('close', (code) => {
      activeChildren.delete(child);

      if (settled) {
        return;
      }

      settled = true;

      if (timer) {
        clearTimeout(timer);
      }

      if (timedOut) {
        reject(
          new ProcessError(
            `${command} timeout setelah ${Math.round((Date.now() - startedAt) / 1000)} detik`,
            result(code ?? -1),
          ),
        );
        return;
      }

      resolve(result(code ?? -1));
    });
  });
}
