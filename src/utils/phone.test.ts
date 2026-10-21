import { describe, expect, it } from 'vitest';
import { isGroupJid, normalizePhone, phoneFromJid } from './phone.js';

describe('normalizePhone', () => {
  it('converts Indonesian local numbers', () => {
    expect(normalizePhone('0812-3456-7890')).toBe('6281234567890');
  });

  it('keeps international numbers', () => {
    expect(normalizePhone('+62 812 3456 7890')).toBe('6281234567890');
    expect(normalizePhone('14155552671')).toBe('14155552671');
  });

  it('handles international 00 prefix', () => {
    expect(normalizePhone('0062 812 3456 7890')).toBe('6281234567890');
  });

  it('rejects short numbers', () => {
    expect(normalizePhone('12345')).toBeNull();
  });
});

describe('phoneFromJid', () => {
  it('extracts phone JIDs', () => {
    expect(phoneFromJid('6281234567890@s.whatsapp.net')).toBe('6281234567890');
    expect(phoneFromJid('6281234567890@c.us')).toBe('6281234567890');
  });

  it('does not treat LIDs as phone numbers', () => {
    expect(phoneFromJid('123456789012345@lid')).toBeNull();
    expect(phoneFromJid('120363012345678901@g.us')).toBeNull();
  });
});

describe('isGroupJid', () => {
  it('detects groups', () => {
    expect(isGroupJid('120363012345678901@g.us')).toBe(true);
    expect(isGroupJid('6281234567890@s.whatsapp.net')).toBe(false);
  });
});
