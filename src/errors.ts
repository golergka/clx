// Custom error types for better error handling and exit codes

export enum ExitCode {
  SUCCESS = 0,
  GENERAL_ERROR = 1,
  USAGE_ERROR = 2,
  CONFIG_ERROR = 3,
  AUTH_ERROR = 4,
  NETWORK_ERROR = 5,
  API_ERROR = 6,
  SPEC_ERROR = 7,
  IO_ERROR = 8,
}

export class ClxError extends Error {
  constructor(
    message: string,
    public exitCode: ExitCode = ExitCode.GENERAL_ERROR,
    public hint?: string
  ) {
    super(message);
    this.name = 'ClxError';
  }
}

export class UsageError extends ClxError {
  constructor(message: string, hint?: string) {
    super(message, ExitCode.USAGE_ERROR, hint);
    this.name = 'UsageError';
  }
}

export class ConfigError extends ClxError {
  constructor(message: string, hint?: string) {
    super(message, ExitCode.CONFIG_ERROR, hint);
    this.name = 'ConfigError';
  }
}

export class AuthError extends ClxError {
  constructor(message: string, hint?: string) {
    super(message, ExitCode.AUTH_ERROR, hint);
    this.name = 'AuthError';
  }
}

export class NetworkError extends ClxError {
  constructor(message: string, hint?: string) {
    super(message, ExitCode.NETWORK_ERROR, hint);
    this.name = 'NetworkError';
  }
}

export class ApiError extends ClxError {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: unknown,
    hint?: string
  ) {
    super(message, ExitCode.API_ERROR, hint);
    this.name = 'ApiError';
  }
}

export class SpecError extends ClxError {
  constructor(message: string, hint?: string) {
    super(message, ExitCode.SPEC_ERROR, hint);
    this.name = 'SpecError';
  }
}

export class IoError extends ClxError {
  constructor(message: string, hint?: string) {
    super(message, ExitCode.IO_ERROR, hint);
    this.name = 'IoError';
  }
}

// Format error for output
export function formatError(error: unknown): { message: string; exitCode: number } {
  if (error instanceof ClxError) {
    let message = `Error: ${error.message}`;
    if (error.hint) {
      message += `\nHint: ${error.hint}`;
    }
    return { message, exitCode: error.exitCode };
  }

  if (error instanceof Error) {
    // Handle known error types
    const msg = error.message.toLowerCase();

    if (msg.includes('enotfound') || msg.includes('dns')) {
      return {
        message: `Network error: Could not resolve host\nHint: Check your internet connection and DNS settings`,
        exitCode: ExitCode.NETWORK_ERROR,
      };
    }

    if (msg.includes('econnrefused')) {
      return {
        message: `Network error: Connection refused\nHint: The server may be down or unreachable`,
        exitCode: ExitCode.NETWORK_ERROR,
      };
    }

    if (msg.includes('etimedout') || msg.includes('timeout')) {
      return {
        message: `Network error: Connection timed out\nHint: The server may be slow or unreachable`,
        exitCode: ExitCode.NETWORK_ERROR,
      };
    }

    if (msg.includes('certificate') || msg.includes('ssl') || msg.includes('tls')) {
      return {
        message: `Network error: SSL/TLS certificate error\nHint: The server's certificate may be invalid or expired`,
        exitCode: ExitCode.NETWORK_ERROR,
      };
    }

    if (msg.includes('eacces') || msg.includes('permission denied')) {
      return {
        message: `Permission error: ${error.message}\nHint: Check file/directory permissions`,
        exitCode: ExitCode.IO_ERROR,
      };
    }

    if (msg.includes('enoent') || msg.includes('no such file')) {
      return {
        message: `File not found: ${error.message}`,
        exitCode: ExitCode.IO_ERROR,
      };
    }

    if (msg.includes('enospc')) {
      return {
        message: `Disk full: ${error.message}\nHint: Free up disk space and try again`,
        exitCode: ExitCode.IO_ERROR,
      };
    }

    return {
      message: `Error: ${error.message}`,
      exitCode: ExitCode.GENERAL_ERROR,
    };
  }

  return {
    message: `Error: ${String(error)}`,
    exitCode: ExitCode.GENERAL_ERROR,
  };
}

// Validate OpenAPI spec structure
export function validateSpec(spec: unknown): asserts spec is { openapi: string; info: { title: string; version: string }; paths: Record<string, unknown> } {
  if (!spec || typeof spec !== 'object') {
    throw new SpecError('Invalid spec: not an object');
  }

  const s = spec as Record<string, unknown>;

  if (!s.openapi && !s.swagger) {
    throw new SpecError(
      'Invalid spec: missing openapi or swagger version',
      'Ensure the spec has an "openapi" field (e.g., "openapi": "3.0.0")'
    );
  }

  if (s.swagger) {
    throw new SpecError(
      'OpenAPI 2.0 (Swagger) is not supported',
      'Convert your spec to OpenAPI 3.x using https://editor.swagger.io'
    );
  }

  const version = String(s.openapi);
  if (!version.startsWith('3.')) {
    throw new SpecError(
      `Unsupported OpenAPI version: ${version}`,
      'Only OpenAPI 3.x is supported'
    );
  }

  if (!s.info || typeof s.info !== 'object') {
    throw new SpecError('Invalid spec: missing info section');
  }

  const info = s.info as Record<string, unknown>;
  if (!info.title || typeof info.title !== 'string') {
    throw new SpecError('Invalid spec: missing info.title');
  }

  if (!s.paths || typeof s.paths !== 'object') {
    throw new SpecError(
      'Invalid spec: missing paths section',
      'The spec must define at least one API path'
    );
  }
}

// Sanitize filename to prevent path traversal
export function sanitizeFilename(name: string): string {
  // Remove path separators and parent directory references
  return name
    .replace(/[/\\]/g, '')
    .replace(/\.\./g, '')
    .replace(/[<>:"|?*]/g, '')
    .trim();
}

// Validate API name
export function validateApiName(name: string): void {
  const sanitized = sanitizeFilename(name);

  if (!sanitized) {
    throw new UsageError('Invalid API name: empty after sanitization');
  }

  if (sanitized !== name) {
    throw new UsageError(
      `Invalid API name: contains invalid characters`,
      `Use only alphanumeric characters, hyphens, and underscores`
    );
  }

  if (sanitized.length > 64) {
    throw new UsageError('API name too long (max 64 characters)');
  }

  // Reserved names
  const reserved = ['clx', 'help', 'version', 'auth', 'install', 'remove', 'list', 'update', 'search', 'add', 'doctor'];
  if (reserved.includes(sanitized.toLowerCase())) {
    throw new UsageError(
      `Invalid API name: '${sanitized}' is reserved`,
      `Choose a different name`
    );
  }
}
