import { describe, expect, it } from 'vitest';
import { detectLink, detectLinks } from './detect.js';

describe('detectLinks', () => {
  it('accepts TikTok video and photo posts', () => {
    expect(
      detectLink('cek https://www.tiktok.com/@user/video/1234567890?is_from_webapp=1'),
    ).toMatchObject({ platform: 'tiktok' });
    expect(detectLink('https://www.tiktok.com/@user/photo/1234567890')).toMatchObject({
      platform: 'tiktok',
    });
  });

  it('accepts TikTok short links', () => {
    expect(detectLink('https://vt.tiktok.com/ABC123/')).toMatchObject({ platform: 'tiktok' });
  });

  it('accepts Instagram posts, reels, and share links', () => {
    expect(detectLink('https://www.instagram.com/p/ABC123/')).toMatchObject({
      platform: 'instagram',
    });
    expect(detectLink('https://www.instagram.com/reel/ABC123/?igsh=abc')).toMatchObject({
      platform: 'instagram',
    });
    expect(detectLink('https://www.instagram.com/share/reel/ABC123/')).toMatchObject({
      platform: 'instagram',
    });
  });

  it('normalizes http to https and removes fragments', () => {
    expect(detectLink('http://www.tiktok.com/@user/video/123#comments')?.url).toBe(
      'https://www.tiktok.com/@user/video/123',
    );
  });

  it('rejects profiles and non-post URLs', () => {
    expect(detectLink('https://www.tiktok.com/@user')).toBeNull();
    expect(detectLink('https://www.instagram.com/someusername/')).toBeNull();
    expect(detectLink('https://www.instagram.com/explore/tags/meme/')).toBeNull();
    expect(detectLink('https://www.instagram.com/reel/')).toBeNull();
    expect(detectLink('https://www.instagram.com/reels/audio/123/')).toBeNull();
  });

  it('rejects lookalike domains and unsupported protocols', () => {
    expect(detectLink('https://tiktok.com.evil.example/@user/video/123')).toBeNull();
    expect(detectLink('https://www.instagram.com.evil.example/reel/ABC/')).toBeNull();
    expect(detectLink('javascript://www.tiktok.com/@user/video/123')).toBeNull();
  });

  it('deduplicates and returns all supported links', () => {
    const links = detectLinks(
      'https://www.tiktok.com/@user/video/123 https://www.instagram.com/reel/ABC/ https://www.tiktok.com/@user/video/123',
    );

    expect(links).toHaveLength(2);
    expect(links.map((link) => link.platform)).toEqual(['tiktok', 'instagram']);
  });
});
