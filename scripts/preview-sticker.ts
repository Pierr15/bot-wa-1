import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { Transformer } from '@napi-rs/image';
import { createSticker } from '../src/sticker/render.js';

async function sampleImage(): Promise<Buffer> {
  const width = 900;
  const height = 1200;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#0f172a');
  gradient.addColorStop(0.55, '#0ea5e9');
  gradient.addColorStop(1, '#fbbf24');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.arc(450, 480, 210, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(380, 440, 24, 0, Math.PI * 2);
  ctx.arc(520, 440, 24, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.arc(450, 520, 90, 0.2, Math.PI - 0.2);
  ctx.stroke();

  return canvas.encode('jpeg', { quality: 92 });
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  const input = inputPath ? await readFile(inputPath) : await sampleImage();
  const result = await createSticker({
    input,
    mimeType: inputPath ? undefined : 'image/jpeg',
    text: {
      top: 'ATAS: CONTOH STIKER',
      bottom: 'BAWAH: TEKS MEME INDONESIA',
    },
    maxInputBytes: 10 * 1024 * 1024,
    fontPath: path.resolve('assets/fonts/Anton-Regular.ttf'),
  });

  await mkdir(path.resolve('data/tmp'), { recursive: true });
  const webpPath = path.resolve('data/tmp/preview.webp');
  const pngPath = path.resolve('data/tmp/preview.png');
  await writeFile(webpPath, result.buffer);

  const png = await new Transformer(result.buffer).png();
  await writeFile(pngPath, png);

  console.log(`WebP: ${webpPath} (${result.bytes} bytes, quality ${result.quality})`);
  console.log(`PNG : ${pngPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
