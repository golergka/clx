// Custom error types with semantic exit codes and structured messages

import { red, yellow, cyan, dim, bold, blueUnderline, symbols, useColor } from './ui.js';

export enum ExitCode {
  SUCCESS = 0,
  GENERAL_ERROR = 1,
  USAGE_ERROR = 2,
  NETWORK_ERROR = 3,
  AUTH_ERROR = 4,
  NOT_FOUND = 5,
  SPEC_ERROR = 6,
  CONFIG_ERROR = 64,  // sysexits.h EX_USAGE
  IO_ERROR = 74,      // sysexits.h EX_IOERR
}

export class ClxError extends Error {
  constructor(
    message: string,
    public exitCode: ExitCode = ExitCode.GENERAL_ERROR,
    public hint?: string,
    public url?: string
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
  constructor(message: string, hint?: string, url?: string) {
    super(message, ExitCode.AUTH_ERROR, hint, url);
    this.name = 'AuthError';
  }
}

export class NetworkError extends ClxError {
  constructor(message: string, hint?: string, url?: string) {
    super(message, ExitCode.NETWORK_ERROR, hint, url);
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
    super(message, ExitCode.GENERAL_ERROR, hint);
    this.name = 'ApiError';
  }
}

export class SpecError extends ClxError {
  constructor(message: string, hint?: string, url?: string) {
    super(message, ExitCode.SPEC_ERROR, hint, url);
    this.name = 'SpecError';
  }
}

export class NotFoundError extends ClxError {
  constructor(message: string, hint?: string) {
    super(message, ExitCode.NOT_FOUND, hint);
    this.name = 'NotFoundError';
  }
}

export class IoError extends ClxError {
  constructor(message: string, hint?: string) {
    super(message, ExitCode.IO_ERROR, hint);
    this.name = 'IoError';
  }
}

// Format error with what/why/how structure
export function formatError(error: unknown): { message: string; exitCode: number } {
  // Handle ClxError with structured output
  if (error instanceof ClxError) {
    return formatClxError(error);
  }

  // Handle standard errors
  if (error instanceof Error) {
    return formatStandardError(error);
  }

  // Unknown error type
  return {
    message: formatErrorOutput('Error', String(error)),
    exitCode: ExitCode.GENERAL_ERROR,
  };
}

function formatClxError(error: ClxError): { message: string; exitCode: number } {
  const lines: string[] = [];

  // What failed
  lines.push(`  ${red(symbols.error)} ${bold(error.name.replace('Error', ' error'))}`);
  lines.push('');

  // Why it failed
  lines.push(`    ${error.message}`);

  // How to fix
  if (error.hint) {
    lines.push('');
    lines.push(`    ${error.hint}`);
  }

  // URL for more info
  if (error.url) {
    lines.push(`    ${blueUnderline(error.url)}`);
  }

  return {
    message: lines.join('\n'),
    exitCode: error.exitCode,
  };
}

function formatStandardError(error: Error): { message: string; exitCode: number } {
  const msg = error.message.toLowerCase();

  // Network errors
  if (msg.includes('enotfound') || msg.includes('getaddrinfo')) {
    return {
      message: formatErrorOutput(
        'Network error',
        'Could not resolve host.',
        'Check your internet connection and DNS settings.'
      ),
      exitCode: ExitCode.NETWORK_ERROR,
    };
  }

  if (msg.includes('econnrefused')) {
    return {
      message: formatErrorOutput(
        'Network error',
        'Connection refused.',
        'The server may be down or unreachable.'
      ),
      exitCode: ExitCode.NETWORK_ERROR,
    };
  }

  if (msg.includes('etimedout') || msg.includes('timeout') || msg.includes('aborted')) {
    return {
      message: formatErrorOutput(
        'Network error',
        'Request timed out.',
        'The server may be slow or unreachable. Try again.'
      ),
      exitCode: ExitCode.NETWORK_ERROR,
    };
  }

  if (msg.includes('certificate') || msg.includes('ssl') || msg.includes('tls')) {
    return {
      message: formatErrorOutput(
        'Network error',
        'SSL/TLS certificate error.',
        'The server\'s certificate may be invalid or expired.'
      ),
      exitCode: ExitCode.NETWORK_ERROR,
    };
  }

  // File system errors
  if (msg.includes('eacces') || msg.includes('permission denied')) {
    return {
      message: formatErrorOutput(
        'Permission denied',
        error.message,
        'Check file/directory permissions.'
      ),
      exitCode: ExitCode.IO_ERROR,
    };
  }

  if (msg.includes('enoent') || msg.includes('no such file')) {
    return {
      message: formatErrorOutput(
        'File not found',
        error.message
      ),
      exitCode: ExitCode.NOT_FOUND,
    };
  }

  if (msg.includes('enospc')) {
    return {
      message: formatErrorOutput(
        'Disk full',
        error.message,
        'Free up disk space and try again.'
      ),
      exitCode: ExitCode.IO_ERROR,
    };
  }

  if (msg.includes('eisdir')) {
    return {
      message: formatErrorOutput(
        'Is a directory',
        error.message,
        'Expected a file, not a directory.'
      ),
      exitCode: ExitCode.USAGE_ERROR,
    };
  }

  // JSON/Parse errors
  if (msg.includes('json') || msg.includes('parse') || msg.includes('unexpected token')) {
    return {
      message: formatErrorOutput(
        'Parse error',
        error.message,
        'The file or response contains invalid JSON/YAML.'
      ),
      exitCode: ExitCode.SPEC_ERROR,
    };
  }

  // Default
  return {
    message: formatErrorOutput('Error', error.message),
    exitCode: ExitCode.GENERAL_ERROR,
  };
}

function formatErrorOutput(title: string, message: string, hint?: string, url?: string): string {
  const lines: string[] = [];

  lines.push(`  ${red(symbols.error)} ${bold(title)}`);
  lines.push('');
  lines.push(`    ${message}`);

  if (hint) {
    lines.push('');
    lines.push(`    ${hint}`);
  }

  if (url) {
    lines.push(`    ${blueUnderline(url)}`);
  }

  return lines.join('\n');
}

// Format error for JSON output
export function formatErrorJson(error: unknown): { error: { type: string; message: string; hint?: string } } {
  if (error instanceof ClxError) {
    return {
      error: {
        type: error.name.replace('Error', '').toLowerCase(),
        message: error.message,
        hint: error.hint,
      },
    };
  }

  if (error instanceof Error) {
    return {
      error: {
        type: 'error',
        message: error.message,
      },
    };
  }

  return {
    error: {
      type: 'error',
      message: String(error),
    },
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
      'Missing openapi or swagger version field.',
      'Ensure the spec has an "openapi" field (e.g., "openapi": "3.0.0")'
    );
  }

  if (s.swagger) {
    throw new SpecError(
      'OpenAPI 2.0 (Swagger) is not supported.',
      'Convert your spec to OpenAPI 3.x.',
      'https://editor.swagger.io'
    );
  }

  const version = String(s.openapi);
  if (!version.startsWith('3.')) {
    throw new SpecError(
      `Unsupported OpenAPI version: ${version}`,
      'Only OpenAPI 3.x is supported.'
    );
  }

  if (!s.info || typeof s.info !== 'object') {
    throw new SpecError('Invalid spec: missing info section.');
  }

  const info = s.info as Record<string, unknown>;
  if (!info.title || typeof info.title !== 'string') {
    throw new SpecError('Invalid spec: missing info.title');
  }

  if (!s.paths || typeof s.paths !== 'object') {
    throw new SpecError(
      'Invalid spec: missing paths section.',
      'The spec must define at least one API path.'
    );
  }
}

// Sanitize filename to prevent path traversal
export function sanitizeFilename(name: string): string {
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
    throw new UsageError(
      'Invalid API name: empty after sanitization.',
      'Use only alphanumeric characters, hyphens, and underscores.'
    );
  }

  if (sanitized !== name) {
    throw new UsageError(
      'Invalid API name: contains invalid characters.',
      'Use only alphanumeric characters, hyphens, and underscores.'
    );
  }

  if (sanitized.length > 64) {
    throw new UsageError('API name too long (max 64 characters).');
  }

  // Reserved names
  const reserved = ['clx', 'help', 'version', 'auth', 'install', 'remove', 'list', 'update', 'search', 'add', 'doctor', 'setup', 'completion', 'completions'];
  if (reserved.includes(sanitized.toLowerCase())) {
    throw new UsageError(
      `Invalid API name: '${sanitized}' is reserved.`,
      'Choose a different name.'
    );
  }
}

// Suggest similar command for typos
export function suggestCommand(input: string, commands: string[]): string | null {
  const inputLower = input.toLowerCase();

  // Exact prefix match
  const prefixMatches = commands.filter(c => c.startsWith(inputLower));
  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }

  // Contains match
  const containsMatches = commands.filter(c => c.includes(inputLower) || inputLower.includes(c));
  if (containsMatches.length === 1) {
    return containsMatches[0];
  }

  // Levenshtein distance for typos (simple implementation)
  let bestMatch: string | null = null;
  let bestDistance = Infinity;

  for (const cmd of commands) {
    const distance = levenshteinDistance(inputLower, cmd);
    if (distance < bestDistance && distance <= 2) {
      bestDistance = distance;
      bestMatch = cmd;
    }
  }

  return bestMatch;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}
