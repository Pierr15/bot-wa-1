import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extensionOf, formatBytes, listMediaFiles, mediaKindOf, mimeTypeOf } from './media.js';

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('media helpers', () => {
  it('maps extensions, mime types, and sizes', () => {
    expect(extensionOf('clip.MP4')).toBe('mp4');
    expect(mediaKindOf('jpg')).toBe('image');
    expect(mediaKindOf('m4a')).toBe('audio');
    expect(mediaKindOf('txt')).toBeNull();
    expect(mimeTypeOf('mp4')).toBe('video/mp4');
    expect(mimeTypeOf('unknown')).toBe('application/octet-stream');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2_048)).toBe('2.0 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('lists only recognized, non-empty media files in sorted order', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'bot-media-'));
    await writeFile(path.join(tempDir, 'b.MP4'), 'video');
    await writeFile(path.join(tempDir, 'a.jpg'), 'image');
    await writeFile(path.join(tempDir, 'notes.txt'), 'ignore');
    await writeFile(path.join(tempDir, '.hidden.jpg'), 'ignore');
    await writeFile(path.join(tempDir, 'empty.png'), '');

    const files = await listMediaFiles(tempDir);

    expect(files.map((file) => file.name)).toEqual(['a.jpg', 'b.MP4']);
    expect(files.map((file) => file.kind)).toEqual(['image', 'video']);
    expect(files.every((file) => file.size > 0)).toBe(true);
    expect(files[0]?.extension).toBe('jpg');
  });
});
