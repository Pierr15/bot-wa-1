import { describe, expect, it } from 'vitest';
import { UserFacingError } from '../core/errors.js';
import { parseStickerText, wrapText } from './text.js';
import { createCanvas } from '@napi-rs/canvas';

describe('parseStickerText', () => {
  it('uses the default position when there is no prefix', () => {
    expect(parseStickerText('halo dunia', 'bottom', 140)).toEqual({ bottom: 'HALO DUNIA' });
    expect(parseStickerText('halo dunia', 'top', 140)).toEqual({ top: 'HALO DUNIA' });
  });

  it('parses top and bottom zones', () => {
    expect(parseStickerText('atas: satu | bawah: dua', 'bottom', 140)).toEqual({
      top: 'SATU',
      bottom: 'DUA',
    });
  });

  it('parses center text', () => {
    expect(parseStickerText('tengah: halo', 'bottom', 140)).toEqual({ center: 'HALO' });
  });

  it('puts unprefixed parts in the default zone', () => {
    expect(parseStickerText('atas: satu | dua', 'bottom', 140)).toEqual({
      top: 'SATU',
      bottom: 'DUA',
    });
  });

  it('rejects center combined with another zone', () => {
    expect(() => parseStickerText('tengah: satu | atas: dua', 'bottom', 140)).toThrow(
      UserFacingError,
    );
  });

  it('rejects text over the limit', () => {
    expect(() => parseStickerText('x'.repeat(141), 'bottom', 140)).toThrow(UserFacingError);
  });

  it('returns null for empty text', () => {
    expect(parseStickerText('   ', 'bottom', 140)).toBeNull();
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
