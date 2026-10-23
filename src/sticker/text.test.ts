import { describe, expect, it } from 'vitest';
import { UserFacingError } from '../core/errors.js';
import { parseStickerText, wrapText } from './text.js';
import { createCanvas } from '@napi-rs/canvas';

describe('parseStickerText', () => {
  it('uses the default position when there is no pipe', () => {
    expect(parseStickerText('halo dunia', 'bottom', 140)).toEqual({ bottom: 'HALO DUNIA' });
    expect(parseStickerText('halo dunia', 'top', 140)).toEqual({ top: 'HALO DUNIA' });
  });

  it('puts right-of-pipe text on top', () => {
    expect(parseStickerText('| halo', 'bottom', 140)).toEqual({ top: 'HALO' });
  });

  it('splits two zones: left = bottom, right = top', () => {
    expect(parseStickerText('satu | dua', 'bottom', 140)).toEqual({
      bottom: 'SATU',
      top: 'DUA',
    });
  });

  it('rejects top pipe text when the default position is center', () => {
    expect(() => parseStickerText('satu | dua', 'center', 140)).toThrow(UserFacingError);
  });

  it('rejects text over the limit', () => {
    expect(() => parseStickerText('x'.repeat(141), 'bottom', 140)).toThrow(UserFacingError);
  });

  it('returns null for empty text', () => {
    expect(parseStickerText('   ', 'bottom', 140)).toBeNull();
  });

  it('returns null when both sides of the pipe are empty', () => {
    expect(parseStickerText('|', 'bottom', 140)).toBeNull();
  });
});

describe('wrapText', () => {
  it('wraps words into multiple lines', () => {
    const ctx = createCanvas(512, 512).getContext('2d');
    ctx.font = '700 64px sans-serif';
    const lines = wrapText(ctx, 'SATU DUA TIGA EMPAT LIMA ENAM TUJUH', 200, 3);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.every((line) => ctx.measureText(line).width <= 200)).toBe(true);
  });
});
