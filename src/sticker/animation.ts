import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppLogger } from '../core/logger.js';
import { UserFacingError } from '../core/errors.js';
import { probeVideoInfo } from '../downloader/media.js';
import { runProcess } from '../downloader/process.js';

export interface AnimatedStickerOptions {
  input: Buffer;
  maxDurationSec: number;
  maxBytes: number;
  ffmpegPath: string;
  ffprobePath: string;
  workDir: string;
  logger?: AppLogger;
}

export interface AnimatedStickerResult {
  buffer: Buffer;
  bytes: number;
  frames: number;
  durationSec: number;
}

/** Probe once whether this ffmpeg build can encode animated WebP. */
export async function animateEncoderAvailable(ffmpegPath: string): Promise<boolean> {
  return /libwebp_anim/iu.test(await encoderList(ffmpegPath));
}

const QUALITIES = [88, 78, 68, 58, 48, 38, 28, 18];

let ffmpegCheck: Promise<string> | null = null;

function encoderList(ffmpegPath: string): Promise<string> {
  if (!ffmpegCheck) {
    ffmpegCheck = (async () => {
      try {
        const result = await runProcess(ffmpegPath, ['-hide_banner', '-encoders'], {
          timeoutMs: 20_000,
        });

        return result.stdout;
      } catch {
        return '';
      }
    })();
  }

  return ffmpegCheck;
}

/** FPS target: 10 fps for short clips, lowering until ~30 frames max. */
function frameRateFor(durationSec: number, maxFrames = 30): number {
  const fps = Math.floor(maxFrames / Math.max(1, durationSec));
  return Math.max(4, Math.min(10, fps));
}

function assertWebp(buffer: Buffer): void {
  const isWebp =
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  if (!isWebp) {
    throw new Error('Output stiker animasi bukan WebP yang valid');
  }
}

export async function createAnimatedSticker({
  input,
  maxDurationSec,
  maxBytes,
  ffmpegPath,
  ffprobePath,
  workDir,
  logger,
}: AnimatedStickerOptions): Promise<AnimatedStickerResult> {
  if (!input.length) {
    throw new UserFacingError('Videonya kosong atau gagal diunduh.');
  }

  if (!(await animateEncoderAvailable(ffmpegPath))) {
    throw new UserFacingError(
      'ffmpeg di perangkat ini tidak mendukung encoder WebP animasi. Pasang ffmpeg yang membawa libwebp.',
    );
  }

  const sourcePath = path.join(workDir, 'anim-source.mp4');
  await writeFile(sourcePath, input);

  const info = await probeVideoInfo(sourcePath, ffprobePath);
  const fullDuration = info.durationSec ?? maxDurationSec;
  const durationSec = Math.min(Math.max(fullDuration, 0.5), maxDurationSec);
  const baseFps = frameRateFor(durationSec);
  const scaleFilter = 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512';

  for (const fps of [baseFps, Math.max(3, Math.floor(baseFps / 2)), 2]) {
    for (const [index, quality] of QUALITIES.entries()) {
      const targetPath = path.join(workDir, `anim-${fps}-${index}.webp`);
      const result = await runProcess(
        ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          sourcePath,
          '-t',
          durationSec.toFixed(2),
          '-vf',
          `fps=${fps},${scaleFilter}`,
          '-c:v',
          'libwebp_anim',
          '-lossless',
          '0',
          '-quality',
          String(quality),
          '-compression_level',
          '5',
          '-an',
          '-loop',
          '0',
          targetPath,
        ],
        { timeoutMs: 120_000 },
      );

      if (result.code !== 0) {
        const stderr = result.stderr.slice(-400);
        logger?.warn({ fps, quality, stderr }, 'ffmpeg gagal encode webp animasi');
        continue;
      }

      const buffer = await readFile(targetPath);
      assertWebp(buffer);

      if (buffer.length <= maxBytes) {
        logger?.debug({ fps, quality, bytes: buffer.length }, 'Stiker animasi terkompres');
        return {
          buffer,
          bytes: buffer.length,
          frames: Math.max(2, Math.round(fps * durationSec)),
          durationSec,
        };
      }
    }
  }

  throw new UserFacingError(
    'Videonya terlalu ramai untuk kompresi animasi. Coba video yang lebih pendek atau lebih sederhana.',
  );
}
