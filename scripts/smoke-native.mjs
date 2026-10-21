import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createCanvas } from '@napi-rs/canvas';
import { ResizeFilterType, ResizeFit, Transformer } from '@napi-rs/image';

const require = createRequire(import.meta.url);

function packageVersion(name) {
  try {
    return require(`${name}/package.json`).version;
  } catch {
    return 'unknown';
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  console.log('Native smoke test');
  console.log('  node    :', process.version);
  console.log('  platform:', `${process.platform}/${process.arch}`);
  console.log('  canvas  :', packageVersion('@napi-rs/canvas'));
  console.log('  image   :', packageVersion('@napi-rs/image'));

  const canvas = createCanvas(1200, 1600);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 1200, 1600);
  gradient.addColorStop(0, '#123456');
  gradient.addColorStop(1, '#fedcba');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1200, 1600);

  for (let i = 0; i < 20_000; i += 1) {
    ctx.fillStyle = `rgba(${Math.floor(Math.random() * 255)},${Math.floor(
      Math.random() * 255,
    )},${Math.floor(Math.random() * 255)},0.45)`;
    ctx.fillRect(Math.random() * 1200, Math.random() * 1600, 4, 4);
  }

  ctx.font = 'bold 96px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 12;
  ctx.strokeText('TES', 380, 820);
  ctx.fillText('TES', 380, 820);

  const jpeg = await canvas.encode('jpeg', { quality: 90 });
  assert(jpeg.length > 0, 'Gagal membuat JPEG dari canvas');

  let webp;
  const qualities = [82, 70, 58, 46, 34, 24];

  for (const quality of qualities) {
    webp = await new Transformer(jpeg)
      .rotate()
      .resize({
        width: 512,
        height: 512,
        fit: ResizeFit.Cover,
        filter: ResizeFilterType.Lanczos3,
      })
      .webp(quality);

    if (webp.length <= 100 * 1024) {
      console.log(`  webp    : quality ${quality}, ${webp.length} bytes`);
      break;
    }
  }

  assert(webp && webp.length > 0, 'Gagal encode WebP');
  assert(webp.length <= 100 * 1024, `WebP terlalu besar: ${webp.length} bytes`);
  assert(webp.subarray(0, 4).toString('ascii') === 'RIFF', 'Header RIFF tidak valid');
  assert(webp.subarray(8, 12).toString('ascii') === 'WEBP', 'Format WebP tidak valid');

  const metadata = await new Transformer(webp).metadata();
  assert(metadata.width === 512, `Lebar salah: ${metadata.width}`);
  assert(metadata.height === 512, `Tinggi salah: ${metadata.height}`);

  await readFile(new URL('../package.json', import.meta.url), 'utf8');
  console.log('  result  : PASS');
}

main().catch((error) => {
  console.error('  result  : FAIL');
  console.error(error);
  process.exitCode = 1;
});
