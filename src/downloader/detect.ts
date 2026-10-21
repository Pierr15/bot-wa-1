import { extractUrls } from '../bot/messages.js';

export type DownloadPlatform = 'tiktok' | 'instagram';

export interface DetectedLink {
  platform: DownloadPlatform;
  url: string;
  host: string;
}

const SHORT_TIKTOK_HOSTS = new Set(['vt.tiktok.com', 'vm.tiktok.com', 't.tiktok.com']);

function isHostOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function isTikTokPostPath(host: string, pathname: string): boolean {
  if (SHORT_TIKTOK_HOSTS.has(host)) {
    return pathname.length > 1;
  }

  return (
    /^\/@[^/]+\/(video|photo)\/\d+/u.test(pathname) ||
    /^\/t\/[^/]+/u.test(pathname) ||
    /^\/v\/\d+/u.test(pathname)
  );
}

function isInstagramPostPath(pathname: string): boolean {
  if (/^\/reels\/audio\//u.test(pathname)) {
    return false;
  }

  return /^\/(p|reel|reels|tv|share)\/[^/]+/u.test(pathname);
}

/**
 * Only post URLs are accepted. Profiles and hashtags are deliberately rejected
 * so a single message cannot trigger a playlist or scraper run.
 */
export function detectLinks(text: string): DetectedLink[] {
  const results: DetectedLink[] = [];
  const seen = new Set<string>();

  for (const raw of extractUrls(text)) {
    let url: URL;

    try {
      url = new URL(raw);
    } catch {
      continue;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      continue;
    }

    if (url.username || url.password) {
      continue;
    }

    if (url.port && url.port !== '80' && url.port !== '443') {
      continue;
    }

    const host = url.hostname.toLowerCase().replace(/\.$/u, '');
    let platform: DownloadPlatform | null = null;

    if (isHostOrSubdomain(host, 'tiktok.com') && isTikTokPostPath(host, url.pathname)) {
      platform = 'tiktok';
    } else if (isHostOrSubdomain(host, 'instagram.com') && isInstagramPostPath(url.pathname)) {
      platform = 'instagram';
    } else if (isHostOrSubdomain(host, 'instagr.am') && isInstagramPostPath(url.pathname)) {
      platform = 'instagram';
    }

    if (!platform) {
      continue;
    }

    url.protocol = 'https:';
    url.hash = '';
    const normalized = url.toString();

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    results.push({ platform, url: normalized, host });
  }

  return results;
}

export function detectLink(text: string): DetectedLink | null {
  return detectLinks(text)[0] ?? null;
}
