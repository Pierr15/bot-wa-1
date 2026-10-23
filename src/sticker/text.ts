import { GlobalFonts, createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { StickerPosition } from '../config.js';
import { UserFacingError } from '../core/errors.js';

export interface TextZones {
  top?: string;
  bottom?: string;
  center?: string;
}

const CANVAS_SIZE = 512;
const MARGIN = 28;
const BOTTOM_MARGIN = 14;
const MAX_WIDTH = 448;
const MAX_LINES = 3;
const MIN_FONT_SIZE = 22;
const MAX_FONT_SIZE = 86;
const LINE_HEIGHT_FACTOR = 1.04;

const loadedFonts = new Map<string, string>();

function ensureFont(fontPath: string): string {
  const loaded = loadedFonts.get(fontPath);
  if (loaded) {
    return loaded;
  }

  let family = 'sans-serif';

  try {
    const registered = GlobalFonts.registerFromPath(fontPath, 'Anton');
    if (registered) {
      family = 'Anton';
    }
  } catch {
    family = 'sans-serif';
  }

  loadedFonts.set(fontPath, family);
  return family;
}

function normalizeZone(value: string): string {
  return value
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleUpperCase('id-ID');
}

function appendZone(existing: string | undefined, value: string): string {
  return existing ? `${existing} ${value}` : value;
}

export function parseStickerText(
  raw: string,
  defaultPosition: StickerPosition,
  maxChars: number,
): TextZones | null {
  const cleaned = raw.trim();

  if (!cleaned) {
    return null;
  }

  if ([...cleaned].length > maxChars) {
    throw new UserFacingError(`Teks stiker maksimal ${maxChars} karakter.`);
  }

  // Teks di kiri `|` jatuh ke posisi default (bawah), teks di kanan jatuh ke atas.
  const separator = cleaned.indexOf('|');
  const left = (separator === -1 ? cleaned : cleaned.slice(0, separator)).trim();
  const right = separator === -1 ? '' : cleaned.slice(separator + 1).trim();

  if (!left && !right) {
    return null;
  }

  const zones: TextZones = {};

  if (left) {
    zones[defaultPosition] = normalizeZone(left);
  }

  if (right) {
    if (defaultPosition === 'center') {
      throw new UserFacingError(
        'Teks setelah `|` tidak bisa dipakai saat posisi default `tengah` aktif.',
      );
    }

    zones.top = zones.top ? appendZone(zones.top, normalizeZone(right)) : normalizeZone(right);
  }

  return zones;
}

export function wrapText(
  ctx: SKRSContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  const pushWordParts = (word: string): void => {
    if (ctx.measureText(word).width <= maxWidth) {
      if (!current) {
        current = word;
        return;
      }

      const candidate = `${current} ${word}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
      return;
    }

    // Break very long words character by character.
    for (const char of word) {
      const candidate = `${current}${char}`;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = char;
      } else {
        current = candidate;
      }
    }
  };

  for (const word of words) {
    pushWordParts(word);
  }

  if (current) {
    lines.push(current);
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1] ?? '';

  while (last && ctx.measureText(`${last}…`).width > maxWidth) {
    last = last.slice(0, -1);
  }

  kept[maxLines - 1] = `${last}…`;
  return kept;
}

interface ZoneLayout {
  fontSize: number;
  lines: string[];
  height: number;
}

function fitZone(
  ctx: SKRSContext2D,
  text: string,
  family: string,
  maxFontSize: number,
  maxHeight: number,
): ZoneLayout {
  for (let fontSize = maxFontSize; fontSize >= MIN_FONT_SIZE; fontSize -= 2) {
    ctx.font = `700 ${fontSize}px "${family}", "Noto Color Emoji", sans-serif`;
    const lines = wrapText(ctx, text, MAX_WIDTH, MAX_LINES);
    const height = lines.length * fontSize * LINE_HEIGHT_FACTOR;

    if (height <= maxHeight && lines.every((line) => ctx.measureText(line).width <= MAX_WIDTH)) {
      return { fontSize, lines, height };
    }
  }

  ctx.font = `700 ${MIN_FONT_SIZE}px "${family}", "Noto Color Emoji", sans-serif`;
  const lines = wrapText(ctx, text, MAX_WIDTH, MAX_LINES);
  return {
    fontSize: MIN_FONT_SIZE,
    lines,
    height: lines.length * MIN_FONT_SIZE * LINE_HEIGHT_FACTOR,
  };
}

function drawZone(
  ctx: SKRSContext2D,
  layout: ZoneLayout,
  position: 'top' | 'bottom' | 'center',
): void {
  const lineHeight = layout.fontSize * LINE_HEIGHT_FACTOR;
  const startY =
    position === 'top'
      ? MARGIN
      : position === 'bottom'
        ? CANVAS_SIZE - BOTTOM_MARGIN - layout.height
        : (CANVAS_SIZE - layout.height) / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  let y = startY;

  for (const line of layout.lines) {
    // Soft shadow under the text.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(line, CANVAS_SIZE / 2, y);
    ctx.restore();

    ctx.lineWidth = Math.max(8, Math.min(12, layout.fontSize * 0.15));
    ctx.strokeStyle = '#000000';
    ctx.strokeText(line, CANVAS_SIZE / 2, y);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(line, CANVAS_SIZE / 2, y);

    y += lineHeight;
  }
}

export async function renderTextLayer(
  zones: TextZones,
  fontPath: string,
  backgroundColor: string | null = null,
): Promise<Buffer> {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = canvas.getContext('2d');
  const family = ensureFont(fontPath);

  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  if (backgroundColor) {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  }

  const hasTop = Boolean(zones.top);
  const hasBottom = Boolean(zones.bottom);
  const hasCenter = Boolean(zones.center);
  const twoZones = hasTop && hasBottom;

  if (hasCenter) {
    const layout = fitZone(ctx, zones.center!, family, MAX_FONT_SIZE, 300);
    drawZone(ctx, layout, 'center');
  } else {
    const maxFont = twoZones ? 64 : MAX_FONT_SIZE;

    if (hasTop) {
      const layout = fitZone(ctx, zones.top!, family, maxFont, 210);
      drawZone(ctx, layout, 'top');
    }

    if (hasBottom) {
      const layout = fitZone(ctx, zones.bottom!, family, maxFont, 210);
      drawZone(ctx, layout, 'bottom');
    }
  }

  return canvas.encode('png');
}
