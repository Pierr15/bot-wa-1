import type { WAMessageContent } from 'baileys';

export function unwrapMessage(
  content: WAMessageContent | null | undefined,
  depth = 0,
): WAMessageContent | null {
  if (!content || depth > 4) {
    return null;
  }

  if (content.ephemeralMessage?.message) {
    return unwrapMessage(content.ephemeralMessage.message, depth + 1);
  }

  if (content.viewOnceMessage?.message) {
    return unwrapMessage(content.viewOnceMessage.message, depth + 1);
  }

  if (content.viewOnceMessageV2?.message) {
    return unwrapMessage(content.viewOnceMessageV2.message, depth + 1);
  }

  if (content.viewOnceMessageV2Extension?.message) {
    return unwrapMessage(content.viewOnceMessageV2Extension.message, depth + 1);
  }

  if (content.documentWithCaptionMessage?.message) {
    return unwrapMessage(content.documentWithCaptionMessage.message, depth + 1);
  }

  return content;
}

export function getMessageText(content: WAMessageContent | null | undefined): string | null {
  const message = unwrapMessage(content);
  if (!message) {
    return null;
  }

  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    message.documentMessage?.caption ??
    null
  );
}

export function getImageMessage(content: WAMessageContent | null | undefined) {
  const message = unwrapMessage(content);
  if (!message) {
    return null;
  }

  if (message.imageMessage) {
    return message.imageMessage;
  }

  const quoted = getQuotedMessage(message);
  return quoted?.imageMessage ?? null;
}

export function getQuotedMessage(content: WAMessageContent): WAMessageContent | null {
  const contextInfo =
    content.extendedTextMessage?.contextInfo ??
    content.imageMessage?.contextInfo ??
    content.videoMessage?.contextInfo ??
    content.documentMessage?.contextInfo ??
    content.audioMessage?.contextInfo ??
    content.stickerMessage?.contextInfo;

  return contextInfo?.quotedMessage ? unwrapMessage(contextInfo.quotedMessage) : null;
}

export function isImageMessage(content: WAMessageContent | null | undefined): boolean {
  return Boolean(getImageMessage(content));
}

export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"']+/giu) ?? [];
  const unique = new Set<string>();

  for (const match of matches) {
    const cleaned = match.replace(/[.,!?;:)\]}]+$/u, '');
    if (cleaned) {
      unique.add(cleaned);
    }
  }

  return [...unique];
}

export interface ParsedCommand {
  command: string;
  args: string;
}

export function parseCommand(text: string, prefix = '.'): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(prefix)) {
    return null;
  }

  const withoutPrefix = trimmed.slice(prefix.length).trim();
  if (!withoutPrefix) {
    return null;
  }

  const firstSpace = withoutPrefix.search(/\s/u);
  const command = (
    firstSpace === -1 ? withoutPrefix : withoutPrefix.slice(0, firstSpace)
  ).toLowerCase();
  const args = firstSpace === -1 ? '' : withoutPrefix.slice(firstSpace + 1).trim();

  return { command, args };
}
