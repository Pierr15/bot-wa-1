import { fileTypeFromBuffer } from 'file-type';
import { ResizeFilterType, ResizeFit, Transformer } from '@napi-rs/image';
import type { AppLogger } from '../core/logger.js';
import { UserFacingError } from '../core/errors.js';
import { renderTextLayer, type TextZones } from './text.js';

const STICKER_SIZE = 512;
const MAX_STICKER_BYTES = 100 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const WEBP_QUALITIES = [82, 72, 62, 52, 42, 32, 24, 12];
const TEXT_STICKER_QUALITIES = [90, 80, 70, 60, 50, 40, 30, 20];

export interface CreateStickerOptions {
  input: Buffer;
  mimeType?: string | null;
  text?: TextZones | null;
  maxInputBytes: number;
  fontPath: string;
  logger?: AppLogger;
}

export interface StickerResult {
  buffer: Buffer;
  bytes: number;
  quality: number;
}

export interface EncodeStickerOptions {
  input: Buffer;
  maxBytes?: number;
  qualities?: number[];
}

/**
 * Encode a finished PNG (flat render, no photo) into a 100 KB-class sticker
 * WebP. Returns null when every quality step still exceeds maxBytes.
 */
export async function encodeStickerWebp({
  input,
  maxBytes = MAX_STICKER_BYTES,
  qualities = TEXT_STICKER_QUALITIES,
}: EncodeStickerOptions): Promise<{ buffer: Buffer; quality: number } | null> {
  for (const quality of qualities) {
    const buffer = await new Transformer(input).webp(quality);

    if (buffer.length <= maxBytes) {
      return { buffer, quality };
    }
  }

  return null;
}

export async function createSticker({
  input,
  mimeType,
  text,
  maxInputBytes,
  fontPath,
  logger,
}: CreateStickerOptions): Promise<StickerResult> {
  if (input.length === 0) {
    throw new UserFacingError('Fotonya kosong atau gagal diunduh.');
  }

  if (input.length > maxInputBytes) {
    throw new UserFacingError(
      `Ukuran foto terlalu besar. Maksimal ${Math.floor(maxInputBytes / 1024 / 1024)} MB.`,
    );
  }

  const detected = await fileTypeFromBuffer(input).catch(() => undefined);
  const resolvedMime = detected?.mime ?? mimeType ?? '';

  if (!ALLOWED_MIME_TYPES.has(resolvedMime)) {
    throw new UserFacingError('Format foto tidak didukung. Kirim JPEG, PNG, atau WebP.');
  }

  const metadata = await new Transformer(input).metadata();

  if (!metadata.width || !metadata.height) {
    throw new UserFacingError('Gagal membaca ukuran foto.');
  }

  if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
    throw new UserFacingError('Resolusi foto terlalu besar. Coba foto dengan ukuran lebih kecil.');
  }

  const base = await new Transformer(input)
    .rotate()
    .resize({
      width: STICKER_SIZE,
      height: STICKER_SIZE,
      fit: ResizeFit.Cover,
      filter: ResizeFilterType.Lanczos3,
    })
    .png();
  const textLayer = text ? await renderTextLayer(text, fontPath) : null;
  const prepared = textLayer ? await new Transformer(base).overlay(textLayer, 0, 0).png() : base;

  let lastBuffer: Buffer | null = null;
  let lastQuality = 0;

  for (const quality of WEBP_QUALITIES) {
    const buffer = await new Transformer(prepared).webp(quality);
    lastBuffer = buffer;
    lastQuality = quality;

    if (buffer.length <= MAX_STICKER_BYTES) {
      const result = await verifySticker(buffer);
      logger?.debug(
        { quality, bytes: result.bytes, inputBytes: input.length },
        'Stiker berhasil dibuat',
      );
      return { buffer, bytes: result.bytes, quality };
    }
  }

  logger?.warn(
    { bytes: lastBuffer?.length ?? 0, quality: lastQuality },
    'Stiker melebihi batas setelah kompresi normal; mencoba blur tipis',
  );

  // A slight blur on the photo (not the text layer) usually gets noisy
  // low-light photos under WhatsApp's 100 KB limit without making text fuzzy.
  for (const sigma of [0.8, 1.4]) {
    const blurredBase = await new Transformer(base).blur(sigma).png();
    const blurredPrepared = textLayer
      ? await new Transformer(blurredBase).overlay(textLayer, 0, 0).png()
      : blurredBase;

    for (const quality of [40, 28, 18, 10]) {
      const buffer = await new Transformer(blurredPrepared).webp(quality);
      lastBuffer = buffer;
      lastQuality = quality;

      if (buffer.length <= MAX_STICKER_BYTES) {
        const result = await verifySticker(buffer);
        logger?.debug(
          { quality, sigma, bytes: result.bytes, inputBytes: input.length },
          'Stiker berhasil dibuat setelah blur',
        );
        return { buffer, bytes: result.bytes, quality };
      }
    }
  }

  logger?.warn(
    { bytes: lastBuffer?.length ?? 0, quality: lastQuality },
    'Stiker melebihi batas 100 KB setelah kompresi maksimal dan blur',
  );
  throw new UserFacingError('Foto terlalu detail untuk dijadikan stiker. Coba foto lain.');
}

async function verifySticker(
  buffer: Buffer,
): Promise<{ bytes: number; width: number; height: number }> {
  if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF') {
    throw new Error('Stiker bukan file RIFF/WebP yang valid');
  }

  if (buffer.subarray(8, 12).toString('ascii') !== 'WEBP') {
    throw new Error('Stiker bukan file WebP yang valid');
  }

  const metadata = await new Transformer(buffer).metadata();

  if (metadata.width !== STICKER_SIZE || metadata.height !== STICKER_SIZE) {
    throw new Error(`Ukuran stiker salah: ${metadata.width}x${metadata.height}`);
  }

  return {
    bytes: buffer.length,
    width: metadata.width,
    height: metadata.height,
  };
}
