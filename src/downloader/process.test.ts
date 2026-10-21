import { describe, expect, it } from 'vitest';
import { ProcessError, runProcess } from './process.js';

describe('runProcess', () => {
  it('captures stdout and a zero exit code', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("ok")']);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('ok');
    expect(result.stderr).toBe('');
  });

  it('returns a non-zero exit code instead of throwing', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.exit(3)'], {
      timeoutMs: 10_000,
    });

    expect(result.code).toBe(3);
  });

  it('rejects when the binary does not exist', async () => {
    await expect(
      runProcess('bot-wa-command-that-does-not-exist', [], { timeoutMs: 2_000 }),
    ).rejects.toBeInstanceOf(ProcessError);
  });
});
