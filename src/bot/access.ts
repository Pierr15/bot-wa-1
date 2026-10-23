import type { WAMessageKey } from 'baileys';
import type { AppConfig } from '../config.js';
import type { AppLogger } from '../core/logger.js';
import { isGroupJid, phoneFromJid } from '../utils/phone.js';

export type AccessDeniedReason = 'group-disabled' | 'unknown-number' | 'no-phone-identity';

export type AccessDecision =
  | {
      allowed: true;
      isOwner: boolean;
      senderPhones: string[];
    }
  | {
      allowed: false;
      reason: AccessDeniedReason;
      senderPhones: string[];
    };

function collectPhoneCandidates(key: WAMessageKey): string[] {
  const candidates = new Set<string>();

  for (const jid of [key.remoteJidAlt, key.participantAlt, key.participant, key.remoteJid]) {
    const phone = phoneFromJid(jid ?? null);
    if (phone) {
      candidates.add(phone);
    }
  }

  return [...candidates];
}

export class AccessControl {
  private readonly owners: Set<string>;
  private readonly allowed: Set<string>;
  private readonly allowedGroups: Set<string>;

  constructor(
    config: AppConfig,
    private readonly logger: AppLogger,
  ) {
    this.owners = new Set(config.ownerNumbers);
    this.allowed = new Set([...config.ownerNumbers, ...config.allowedNumbers]);
    this.allowedGroups = new Set(config.allowedGroups);
  }

  check(key: WAMessageKey, chatJid: string): AccessDecision {
    const senderPhones = collectPhoneCandidates(key);

    if (isGroupJid(chatJid) && !this.allowedGroups.has(chatJid)) {
      return { allowed: false, reason: 'group-disabled', senderPhones };
    }

    if (senderPhones.length === 0) {
      this.logger.info(
        {
          chatSuffix: chatJid.slice(chatJid.indexOf('@')),
          remoteJidAlt: key.remoteJidAlt,
          participantAlt: key.participantAlt,
          participant: key.participant,
        },
        'Tidak bisa menentukan nomor pengirim (kemungkinan LID); pesan diabaikan',
      );
      return { allowed: false, reason: 'no-phone-identity', senderPhones };
    }

    const isOwner = senderPhones.some((phone) => this.owners.has(phone));
    const allowed = senderPhones.some((phone) => this.allowed.has(phone));

    if (!allowed) {
      this.logger.info(
        {
          senderPhones,
          chatSuffix: chatJid.slice(chatJid.indexOf('@')),
        },
        'Pesan dari nomor di luar whitelist diabaikan',
      );
      return { allowed: false, reason: 'unknown-number', senderPhones };
    }

    return { allowed: true, isOwner, senderPhones };
  }
}
