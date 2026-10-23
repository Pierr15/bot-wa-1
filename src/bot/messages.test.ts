import type { WAMessageContent } from 'baileys';
import { describe, expect, it } from 'vitest';
import {
  extractUrls,
  getImageMessage,
  getMessageText,
  parseCommand,
  unwrapMessage,
} from './messages.js';

describe('unwrapMessage', () => {
  it('unwraps ephemeral messages', () => {
    const content = {
      ephemeralMessage: {
        message: { conversation: 'halo' },
      },
    } as WAMessageContent;

    expect(unwrapMessage(content)?.conversation).toBe('halo');
  });
});

describe('getMessageText', () => {
  it('reads captions from images', () => {
    const content = {
      imageMessage: { caption: 'teks stiker' },
    } as WAMessageContent;

    expect(getMessageText(content)).toBe('teks stiker');
  });

  it('returns null when there is no text', () => {
    expect(getMessageText({} as WAMessageContent)).toBeNull();
  });
});

describe('getImageMessage', () => {
  it('finds an image in a quoted message', () => {
    const content = {
      extendedTextMessage: {
        text: 'alas',
        contextInfo: {
          quotedMessage: {
            imageMessage: { mimetype: 'image/jpeg' },
          },
        },
      },
    } as WAMessageContent;

    expect(getImageMessage(content)?.mimetype).toBe('image/jpeg');
  });
});

describe('extractUrls', () => {
  it('extracts and cleans URLs', () => {
    expect(
      extractUrls('cek https://vt.tiktok.com/ABC123/ dan https://instagram.com/reel/X/.'),
    ).toEqual(['https://vt.tiktok.com/ABC123/', 'https://instagram.com/reel/X/']);
  });
});

describe('parseCommand', () => {
  it('parses commands and arguments', () => {
    expect(parseCommand('.menu')).toEqual({ command: 'menu', args: '' });
    expect(parseCommand('.sticker atas Halo')).toEqual({ command: 'sticker', args: 'atas Halo' });
    expect(parseCommand('.PING')).toEqual({ command: 'ping', args: '' });
  });

  it('ignores normal text', () => {
    expect(parseCommand('halo')).toBeNull();
  });
});
