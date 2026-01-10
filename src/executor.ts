import type { ExecutionContext, OperationInfo, Parameter, AuthProfile, OpenAPISpec, Schema, RequestBody } from './types.js';
import { resolveRef, getSecurityRequirements } from './parser.js';
import { NetworkError, ApiError } from './errors.js';

interface RequestConfig {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

// Parse command line arguments into a key-value map
// Returns flags as Map and customHeaders as array (to support multiple -H)
export function parseArgs(args: string[]): { flags: Map<string, string>; positional: string[]; customHeaders: Array<[string, string]> } {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  const customHeaders: Array<[string, string]> = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        // --key=value
        const key = arg.substring(2, eqIndex);
        const value = arg.substring(eqIndex + 1);
        // Handle --header specially
        if (key === 'header') {
          const colonIdx = value.indexOf(':');
          if (colonIdx > 0) {
            customHeaders.push([value.substring(0, colonIdx).trim(), value.substring(colonIdx + 1).trim()]);
          }
        } else {
          flags.set(key, value);
        }
      } else {
        // --key value or --flag
        const key = arg.substring(2);
        const nextArg = args[i + 1];
        if (key === 'header' && nextArg && !nextArg.startsWith('-')) {
          const colonIdx = nextArg.indexOf(':');
          if (colonIdx > 0) {
            customHeaders.push([nextArg.substring(0, colonIdx).trim(), nextArg.substring(colonIdx + 1).trim()]);
          }
          i++;
        } else if (nextArg && !nextArg.startsWith('--')) {
          flags.set(key, nextArg);
          i++;
        } else {
          flags.set(key, 'true');
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      // -k value or -k
      const key = arg.substring(1);
      const nextArg = args[i + 1];
      // Handle -H for custom headers
      if (key === 'H' && nextArg && !nextArg.startsWith('-')) {
        const colonIdx = nextArg.indexOf(':');
        if (colonIdx > 0) {
          customHeaders.push([nextArg.substring(0, colonIdx).trim(), nextArg.substring(colonIdx + 1).trim()]);
        }
        i++;
      } else if (nextArg && !nextArg.startsWith('-')) {
        flags.set(key, nextArg);
        i++;
      } else {
        flags.set(key, 'true');
      }
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional, customHeaders };
}

// Build the full URL with path and query parameters
function buildUrl(
  baseUrl: string,
  path: string,
  pathParams: Map<string, string>,
  queryParams: Map<string, string>
): string {
  // Replace path parameters
  let url = path;
  for (const [key, value] of pathParams) {
    url = url.replace(`{${key}}`, encodeURIComponent(value));
  }

  // Combine base URL and path
  let fullUrl = baseUrl;
  if (fullUrl.endsWith('/') && url.startsWith('/')) {
    fullUrl = fullUrl.slice(0, -1);
  }
  fullUrl += url;

  // Add query parameters
  if (queryParams.size > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of queryParams) {
      params.set(key, value);
    }
    fullUrl += '?' + params.toString();
  }

  return fullUrl;
}

// Apply authentication to request headers/params
function applyAuth(
  auth: AuthProfile,
  headers: Record<string, string>,
  queryParams: Map<string, string>
): void {
  switch (auth.type) {
    case 'apiKey':
      if (auth.apiKeyHeader && auth.apiKey) {
        headers[auth.apiKeyHeader] = auth.apiKey;
      } else if (auth.apiKeyQuery && auth.apiKey) {
        queryParams.set(auth.apiKeyQuery, auth.apiKey);
      }
      break;
    case 'bearer':
      if (auth.bearerToken) {
        headers['Authorization'] = `Bearer ${auth.bearerToken}`;
      }
      break;
    case 'basic':
      if (auth.username && auth.password) {
        const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
        headers['Authorization'] = `Basic ${encoded}`;
      }
      break;
    case 'oauth2':
      if (auth.oauth2?.accessToken) {
        headers['Authorization'] = `Bearer ${auth.oauth2.accessToken}`;
      }
      break;
  }
}

// Known special flags that should not be passed as query parameters
const SPECIAL_FLAGS = new Set([
  'help', 'h', 'verbose', 'v', 'json', 'data', 'dry-run', 'profile',
  'token', 'api-key', 'header', 'output', 'quiet', 'q', 'all'
]);

// Build request configuration from operation and arguments
export function buildRequest(
  ctx: ExecutionContext,
  opInfo: OperationInfo,
  flags: Map<string, string>,
  stdinData?: string,
  customHeaders?: Array<[string, string]>
): RequestConfig {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  const pathParams = new Map<string, string>();
  const queryParams = new Map<string, string>();
  const processedParams = new Set<string>();

  // Use pre-resolved parameters from parser (refs already resolved)
  const allParams = opInfo.resolvedParameters || opInfo.pathParameters || [];

  for (const param of allParams) {
    const value = flags.get(param.name);
    processedParams.add(param.name);

    if (value !== undefined) {
      if (param.in === 'path') {
        pathParams.set(param.name, value);
      } else if (param.in === 'query') {
        queryParams.set(param.name, value);
      } else if (param.in === 'header') {
        headers[param.name] = value;
      }
    } else if (param.required && param.in === 'path') {
      throw new Error(`Missing required path parameter: ${param.name}`);
    }
  }

  // Pass unknown flags as query parameters (but not special flags)
  for (const [key, value] of flags) {
    if (!processedParams.has(key) && !SPECIAL_FLAGS.has(key)) {
      queryParams.set(key, value);
      if (ctx.verbose) {
        console.error(`  [info] Passing unknown parameter as query: ${key}=${value}`);
      }
    }
  }

  // Handle --token flag for auth override
  const tokenFlag = flags.get('token') || flags.get('api-key');
  if (tokenFlag) {
    // Token flag overrides any auth - use as bearer token
    headers['Authorization'] = `Bearer ${tokenFlag}`;
  } else if (ctx.auth) {
    // Apply auth from context
    applyAuth(ctx.auth, headers, queryParams);
  }

  // Apply custom headers (can override auth if needed)
  if (customHeaders) {
    for (const [key, value] of customHeaders) {
      headers[key] = value;
    }
  }

  // Build URL
  const url = buildUrl(ctx.baseUrl, opInfo.path, pathParams, queryParams);

  // Handle request body - only for methods that support it
  let body: string | undefined;
  const dataFlag = flags.get('data');
  const methodSupportsBody = ['post', 'put', 'patch', 'delete'].includes(opInfo.method);

  if (methodSupportsBody && dataFlag) {
    body = dataFlag;
    headers['Content-Type'] = 'application/json';
  } else if (methodSupportsBody && stdinData) {
    body = stdinData;
    headers['Content-Type'] = 'application/json';
  } else if (['post', 'put', 'patch'].includes(opInfo.method)) {
    // Build body from flags if there's a request body schema
    const requestBody = opInfo.operation.requestBody;
    if (requestBody) {
      const resolvedBody = '$ref' in requestBody
        ? resolveRef<RequestBody>(ctx.spec, requestBody.$ref)
        : requestBody;

      if (resolvedBody && resolvedBody.content['application/json']) {
        const schema = resolvedBody.content['application/json'].schema;
        const bodyObj = buildBodyFromFlags(flags, schema, ctx.spec);
        if (Object.keys(bodyObj).length > 0) {
          body = JSON.stringify(bodyObj);
          headers['Content-Type'] = 'application/json';
        }
      }
    }
  }

  return {
    method: opInfo.method.toUpperCase(),
    url,
    headers,
    body,
  };
}

// Build request body object from command flags
function buildBodyFromFlags(
  flags: Map<string, string>,
  schema: Schema | undefined,
  spec: OpenAPISpec
): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (!schema) return body;

  // Resolve reference if needed
  const resolvedSchema = schema.$ref
    ? resolveRef<Schema>(spec, schema.$ref)
    : schema;

  if (!resolvedSchema?.properties) return body;

  for (const [propName, propSchema] of Object.entries(resolvedSchema.properties)) {
    const value = flags.get(propName);
    if (value !== undefined) {
      body[propName] = coerceValue(value, propSchema);
    }
  }

  return body;
}

// Coerce string value to appropriate type based on schema
function coerceValue(value: string, schema: Schema): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;

  switch (schema.type) {
    case 'integer':
      return parseInt(value, 10);
    case 'number':
      return parseFloat(value);
    case 'boolean':
      return value === 'true';
    case 'array':
      try {
        return JSON.parse(value);
      } catch {
        return value.split(',');
      }
    case 'object':
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    default:
      return value;
  }
}

// Generate curl command for dry-run mode
export function generateCurl(config: RequestConfig): string {
  const parts: string[] = ['curl'];

  // Method (skip for GET)
  if (config.method !== 'GET') {
    parts.push(`-X ${config.method}`);
  }

  // Headers
  for (const [key, value] of Object.entries(config.headers)) {
    // Mask Authorization header value
    if (key.toLowerCase() === 'authorization') {
      parts.push(`-H '${key}: ${value.substring(0, 10)}...'`);
    } else {
      parts.push(`-H '${key}: ${value}'`);
    }
  }

  // Body
  if (config.body) {
    parts.push(`-d '${config.body}'`);
  }

  // URL (quoted)
  parts.push(`'${config.url}'`);

  return parts.join(' \\\n  ');
}

// Retry configuration
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

// Sleep helper
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate exponential backoff with jitter
function calculateBackoff(attempt: number, baseDelay: number, maxDelay: number): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.min(exponentialDelay + jitter, maxDelay);
}

// Parse retry-after header
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;

  // Try parsing as seconds
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // Try parsing as HTTP date
  const date = new Date(header);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return null;
}

// Execute the HTTP request with retry logic
export async function executeRequest(
  config: RequestConfig,
  verbose: boolean,
  retryConfig: Partial<RetryConfig> = {}
): Promise<{ status: number; data: unknown }> {
  const retry = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  let lastError: Error | null = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
    try {
      if (verbose) {
        console.error(`${config.method} ${config.url}${attempt > 0 ? ` (retry ${attempt})` : ''}`);
        for (const [key, value] of Object.entries(config.headers)) {
          if (key.toLowerCase() === 'authorization') {
            console.error(`  ${key}: [REDACTED]`);
          } else {
            console.error(`  ${key}: ${value}`);
          }
        }
        if (config.body) {
          console.error(`  Body: ${config.body.substring(0, 100)}${config.body.length > 100 ? '...' : ''}`);
        }
      }

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

      try {
        const response = await fetch(config.url, {
          method: config.method,
          headers: config.headers,
          body: config.body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        lastResponse = response;

        // Check if we should retry
        if (retry.retryableStatuses.includes(response.status) && attempt < retry.maxRetries) {
          const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
          const delay = retryAfter || calculateBackoff(attempt, retry.baseDelayMs, retry.maxDelayMs);

          if (verbose) {
            console.error(`  Rate limited (${response.status}), retrying in ${Math.round(delay / 1000)}s...`);
          }

          await sleep(delay);
          continue;
        }

        const contentType = response.headers.get('content-type') || '';
        let data: unknown;

        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        if (verbose) {
          console.error(`Response: ${response.status} ${response.statusText}`);
        }

        return { status: response.status, data };

      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      const isTimeout = lastError.name === 'AbortError' || lastError.message.includes('timeout');
      const isNetworkError = lastError.message.includes('ECONNREFUSED') ||
                            lastError.message.includes('ENOTFOUND') ||
                            lastError.message.includes('ETIMEDOUT') ||
                            lastError.message.includes('fetch failed');

      if ((isTimeout || isNetworkError) && attempt < retry.maxRetries) {
        const delay = calculateBackoff(attempt, retry.baseDelayMs, retry.maxDelayMs);

        if (verbose) {
          console.error(`  Network error, retrying in ${Math.round(delay / 1000)}s...`);
        }

        await sleep(delay);
        continue;
      }

      // Not retryable or max retries exceeded
      throw new NetworkError(
        lastError.message,
        'Check your internet connection and try again'
      );
    }
  }

  // Should not reach here, but handle just in case
  if (lastError) {
    throw new NetworkError(lastError.message);
  }

  throw new NetworkError('Request failed after retries');
}

// Execute request without retry (for cases where retry doesn't make sense)
export async function executeRequestOnce(config: RequestConfig, verbose: boolean): Promise<{ status: number; data: unknown }> {
  return executeRequest(config, verbose, { maxRetries: 0 });
}
