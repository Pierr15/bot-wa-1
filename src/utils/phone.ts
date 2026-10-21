const PHONE_JID_SUFFIXES = ['@s.whatsapp.net', '@c.us'] as const;

/**
 * Normalize a phone number to digits only.
 * Indonesian local numbers (08xx) are converted to 62xx.
 */
export function normalizePhone(raw: string, defaultCountryCode = '62'): string | null {
  let digits = raw.replace(/\D/g, '');

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.startsWith('0')) {
    digits = `${defaultCountryCode}${digits.slice(1)}`;
  }

  if (digits.length < 8 || digits.length > 15) {
    return null;
  }

  return digits;
}

export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) {
    return null;
  }

  if (!PHONE_JID_SUFFIXES.some((suffix) => jid.endsWith(suffix))) {
    return null;
  }

  const at = jid.indexOf('@');
  if (at <= 0) {
    return null;
  }

  return normalizePhone(jid.slice(0, at));
}

export function isGroupJid(jid: string | null | undefined): boolean {
  return Boolean(jid?.endsWith('@g.us'));
}

export function isBroadcastJid(jid: string | null | undefined): boolean {
  return jid === 'status@broadcast' || Boolean(jid?.endsWith('@broadcast'));
}

export function isNewsletterJid(jid: string | null | undefined): boolean {
  return Boolean(jid?.endsWith('@newsletter'));
}

export function isPrivateChatJid(jid: string | null | undefined): boolean {
  return Boolean(jid && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')));
}

export function jidServer(jid: string | null | undefined): string | null {
  if (!jid) {
    return null;
  }

  const at = jid.indexOf('@');
  return at >= 0 ? jid.slice(at + 1) : null;
}
