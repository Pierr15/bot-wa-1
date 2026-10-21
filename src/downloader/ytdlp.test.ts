import { describe, expect, it } from 'vitest';
import type { DetectedLink } from './detect.js';
import { buildYtDlpArgs, describeYtDlpFailure } from './ytdlp.js';

const tiktok: DetectedLink = {
  platform: 'tiktok',
  url: 'https://www.tiktok.com/@user/video/123',
  host: 'www.tiktok.com',
};

const instagram: DetectedLink = {
  platform: 'instagram',
  url: 'https://www.instagram.com/reel/ABC/',
  host: 'www.instagram.com',
};

function build(link: DetectedLink, cookiesPath: string | null = null): string[] {
  return buildYtDlpArgs(link, {
    outputTemplate: 'data/tmp/%(id)s.%(ext)s',
    cookiesPath,
    maxSourceBytes: 100 * 1024 * 1024,
  });
}

describe('buildYtDlpArgs', () => {
  it('uses a non-watermarked TikTok selector and caps the source size', () => {
    const args = build(tiktok);
    const formatIndex = args.indexOf('--format');

    expect(args[formatIndex + 1]).toContain('format_note!*=watermark');
    expect(args[formatIndex + 1]).toContain('format_id!^=download_addr');
    expect(args[args.indexOf('--max-filesize') + 1]).toBe('100M');
    expect(args.at(-2)).toBe('--');
    expect(args.at(-1)).toBe(tiktok.url);
  });

  it('does not apply a video format selector to TikTok photo posts', () => {
    const args = build({
      ...tiktok,
      url: 'https://www.tiktok.com/@user/photo/123',
    });

    expect(args).not.toContain('--format');
  });

  it('adds Instagram cookies only when a path is provided', () => {
    expect(build(instagram)).not.toContain('--cookies');
    expect(build(instagram, 'data/cookies/instagram.txt')).toContain('--cookies');
  });
});

describe('describeYtDlpFailure', () => {
  it('explains private or login-required content', () => {
    const result = describeYtDlpFailure('ERROR: This video is private');
    expect(result.userMessage).toContain('private');
  });

  it('explains unsupported URLs and size limits', () => {
    expect(describeYtDlpFailure('ERROR: Unsupported URL').userMessage).toContain('tidak didukung');
    expect(describeYtDlpFailure('ERROR: File is larger than max-filesize').userMessage).toContain(
      'terlalu besar',
    );
  });

  it('falls back to a generic message', () => {
    expect(describeYtDlpFailure('something odd happened').userMessage).toContain('Gagal');
  });
});
