export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly code = 'USER_ERROR',
  ) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}
