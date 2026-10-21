import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { Transformer } from '@napi-rs/image';
import { describe, expect, it } from 'vitest';
import { UserFacingError } from '../core/errors.js';
import { createSticker } from './render.js';

const FONT_PATH = path.resolve('assets/fonts/Anton-Regular.ttf');

async function sampleJpeg(width = 900, height = 1200): Promise<Buffer> {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#1d4ed8');
  gradient.addColorStop(1, '#f59e0b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 80px sans-serif';
  ctx.fillText('SAMPLE', 40, 140);
  return canvas.encode('jpeg', { quality: 90 });
}

describe('createSticker', () => {
  it('creates a 512x512 WebP under 100 KB', async () => {
    const input = await sampleJpeg();
    const result = await createSticker({
      input,
      mimeType: 'image/jpeg',
      maxInputBytes: 10 * 1024 * 1024,
      fontPath: FONT_PATH,
    });

    expect(result.buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(result.buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
    expect(result.bytes).toBeLessThanOrEqual(100 * 1024);

    const metadata = await new Transformer(result.buffer).metadata();
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
  });

  it('adds text zones', async () => {
    const input = await sampleJpeg();
    const result = await createSticker({
      input,
      mimeType: 'image/jpeg',
      text: { top: 'ATAS', bottom: 'BAWAH' },
      maxInputBytes: 10 * 1024 * 1024,
      fontPath: FONT_PATH,
    });

    expect(result.bytes).toBeLessThanOrEqual(100 * 1024);
  });

  it('rejects unsupported input', async () => {
    await expect(
      createSticker({
        input: Buffer.from('bukan gambar'),
        mimeType: 'text/plain',
        maxInputBytes: 10 * 1024 * 1024,
        fontPath: FONT_PATH,
      }),
    ).rejects.toBeInstanceOf(UserFacingError);
  });
});
