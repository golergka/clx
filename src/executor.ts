import type { ExecutionContext, OperationInfo, Parameter, AuthProfile, OpenAPISpec, Schema, RequestBody } from './types.js';
import { resolveRef, getSecurityRequirements } from './parser.js';

interface RequestConfig {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

// Parse command line arguments into a key-value map
export function parseArgs(args: string[]): { flags: Map<string, string>; positional: string[] } {
  const flags = new Map<string, string>();
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        // --key=value
        const key = arg.substring(2, eqIndex);
        const value = arg.substring(eqIndex + 1);
        flags.set(key, value);
      } else {
        // --key value or --flag
        const key = arg.substring(2);
        const nextArg = args[i + 1];
        if (nextArg && !nextArg.startsWith('--')) {
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
      if (nextArg && !nextArg.startsWith('-')) {
        flags.set(key, nextArg);
        i++;
      } else {
        flags.set(key, 'true');
      }
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
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

// Build request configuration from operation and arguments
export function buildRequest(
  ctx: ExecutionContext,
  opInfo: OperationInfo,
  flags: Map<string, string>,
  stdinData?: string
): RequestConfig {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  const pathParams = new Map<string, string>();
  const queryParams = new Map<string, string>();

  // Extract parameters from operation
  const allParams = opInfo.operation.parameters || [];

  for (const param of allParams) {
    const value = flags.get(param.name);
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

  // Apply auth
  if (ctx.auth) {
    applyAuth(ctx.auth, headers, queryParams);
  }

  // Build URL
  const url = buildUrl(ctx.baseUrl, opInfo.path, pathParams, queryParams);

  // Handle request body
  let body: string | undefined;
  const dataFlag = flags.get('data');

  if (dataFlag) {
    body = dataFlag;
    headers['Content-Type'] = 'application/json';
  } else if (stdinData) {
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

// Execute the HTTP request
export async function executeRequest(config: RequestConfig, verbose: boolean): Promise<{ status: number; data: unknown }> {
  if (verbose) {
    console.error(`${config.method} ${config.url}`);
    for (const [key, value] of Object.entries(config.headers)) {
      if (key.toLowerCase() === 'authorization') {
        console.error(`  ${key}: ${value.substring(0, 10)}...`);
      } else {
        console.error(`  ${key}: ${value}`);
      }
    }
    if (config.body) {
      console.error(`  Body: ${config.body.substring(0, 100)}${config.body.length > 100 ? '...' : ''}`);
    }
  }

  const response = await fetch(config.url, {
    method: config.method,
    headers: config.headers,
    body: config.body,
  });

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
}
