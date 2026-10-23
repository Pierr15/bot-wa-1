import pino, { type Logger } from 'pino';

export type AppLogger = Logger;

export interface LoggerOptions {
  level: string;
  pretty: boolean;
}

export function createLogger({ level, pretty }: LoggerOptions): AppLogger {
  return pino({
    level,
    base: { app: 'wa-bot' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname,app',
            },
          },
        }
      : {}),
  });
}

export function createSilentLogger(): AppLogger {
  return pino({ level: 'silent' });
}

