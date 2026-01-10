// Adapter-aware request executor
// Applies adapter configuration to requests and responses

import type { AuthProfile } from './types.js';
import type {
  ResolvedAdapter,
  AdapterContext,
  AdapterRequest,
  AdapterResponse,
  AdapterAuthConfig,
} from './core/index.js';
import { applyAuth as applyAdapterAuth, extractError, flattenToFormData } from './core/index.js';
import { executeRequest as baseExecuteRequest } from './executor.js';
import { NetworkError, ApiError } from './errors.js';

interface ExecuteOptions {
  adapter: ResolvedAdapter;
  auth?: AuthProfile;
  profile?: string;
  verbose?: boolean;
  flags?: Map<string, string>;
}

/**
 * Build adapter context from options
 */
function buildContext(options: ExecuteOptions): AdapterContext {
  return {
    profile: options.profile,
    flags: options.flags,
    secrets: {},
  };
}

/**
 * Apply adapter's request configuration
 */
function applyRequestConfig(
  req: AdapterRequest,
  adapter: ResolvedAdapter,
  ctx: AdapterContext
): AdapterRequest {
  const config = adapter.request;
  if (!config) return req;

  // Apply headers
  if (config.headers) {
    const headers = typeof config.headers === 'function'
      ? config.headers(ctx)
      : config.headers;
    req.headers = { ...req.headers, ...headers };
  }

  // Apply body transformation
  if (config.transformBody && req.body) {
    req.body = config.transformBody(req.body, ctx);
  }

  // Apply full request transformation
  if (config.transform) {
    req = config.transform(req, ctx);
  }

  return req;
}

/**
 * Apply content type configuration
 */
function applyContentType(
  req: AdapterRequest,
  adapter: ResolvedAdapter,
  operationId?: string
): AdapterRequest {
  const config = adapter.content;
  if (!config) return req;

  // Check for operation-specific config first
  if (operationId && config.operations?.[operationId]) {
    const opConfig = config.operations[operationId];
    if (opConfig.requestType && req.body) {
      req.headers['Content-Type'] = opConfig.requestType;
    }
    return req;
  }

  // Apply default request type
  if (config.requestType && req.body) {
    req.headers['Content-Type'] = config.requestType;

    // Convert body if needed
    if (config.requestType === 'application/x-www-form-urlencoded' && typeof req.body === 'object') {
      const flattened = flattenToFormData(req.body as Record<string, unknown>);
      req.body = new URLSearchParams(flattened).toString();
    }
  }

  return req;
}

/**
 * Apply adapter's auth configuration
 */
function applyAuth(
  req: AdapterRequest,
  auth: AuthProfile,
  adapter: ResolvedAdapter,
  ctx: AdapterContext
): void {
  const config = adapter.auth;
  if (!config) {
    // Fall back to default auth handling
    if (auth.bearerToken) {
      req.headers['Authorization'] = `Bearer ${auth.bearerToken}`;
    } else if (auth.apiKey) {
      if (auth.apiKeyHeader) {
        req.headers[auth.apiKeyHeader] = auth.apiKey;
      } else {
        req.headers['Authorization'] = `Bearer ${auth.apiKey}`;
      }
    }
    return;
  }

  applyAdapterAuth(req, auth, config, ctx);
}

/**
 * Apply adapter's response configuration
 */
function applyResponseConfig(
  data: unknown,
  adapter: ResolvedAdapter,
  ctx: AdapterContext
): unknown {
  const config = adapter.response;
  if (!config) return data;

  // Unwrap response
  if (config.unwrap) {
    if (typeof config.unwrap === 'function') {
      data = config.unwrap(data);
    } else if (typeof config.unwrap === 'string') {
      // Path-based unwrap
      const parts = config.unwrap.split('.');
      let current = data as Record<string, unknown>;
      for (const part of parts) {
        if (current == null) break;
        current = current[part] as Record<string, unknown>;
      }
      data = current;
    }
  }

  // Transform response
  if (config.transform) {
    data = config.transform(data, ctx);
  }

  return data;
}

/**
 * Handle error response using adapter config
 */
function handleError(
  status: number,
  data: unknown,
  adapter: ResolvedAdapter,
  ctx: AdapterContext
): void {
  const config = adapter.response;
  const errorConfig = adapter.errors;

  // Check for custom status handlers
  if (config?.handlers?.[status]) {
    const res: AdapterResponse = {
      status,
      headers: {},
      data,
    };
    config.handlers[status](res, ctx);
    return;
  }

  // Extract error details
  const errorInfo = errorConfig ? extractError(data, errorConfig) : { message: String(data) };

  // Map to exit code if configured
  let exitCode = 1;
  if (errorConfig?.exitCodes && errorInfo.code) {
    exitCode = errorConfig.exitCodes[errorInfo.code] || 1;
  }

  throw new ApiError(
    errorInfo.message || 'API request failed',
    status,
    errorInfo.code,
    exitCode
  );
}

/**
 * Get timeout configuration for an operation
 */
function getTimeout(adapter: ResolvedAdapter, operationId?: string): number {
  const config = adapter.timeout;
  if (!config) return 30000;

  // Check for operation-specific timeout
  if (operationId && config.operations?.[operationId]) {
    return config.operations[operationId].request || config.request || 30000;
  }

  return config.request || 30000;
}

/**
 * Get retry configuration from adapter
 */
function getRetryConfig(adapter: ResolvedAdapter): {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
} {
  const config = adapter.rateLimit?.retry;
  if (!config) {
    return { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 };
  }

  return {
    maxRetries: config.maxRetries || 3,
    baseDelayMs: config.initialDelay || 1000,
    maxDelayMs: config.maxDelay || 30000,
  };
}

/**
 * Execute a request using adapter configuration
 */
export async function executeAdapterRequest(
  method: string,
  url: string,
  body: unknown | undefined,
  options: ExecuteOptions,
  operationId?: string
): Promise<{ status: number; data: unknown }> {
  const { adapter, auth, verbose } = options;
  const ctx = buildContext(options);

  // Build initial request
  let req: AdapterRequest = {
    method: method.toUpperCase(),
    url,
    headers: {
      'Accept': 'application/json',
    },
    body,
  };

  // Run beforeRequest hook
  if (adapter.hooks?.beforeRequest) {
    req = await adapter.hooks.beforeRequest(req, ctx);
  }

  // Apply content type
  req = applyContentType(req, adapter, operationId);

  // Apply request configuration
  req = applyRequestConfig(req, adapter, ctx);

  // Apply auth
  if (auth) {
    applyAuth(req, auth, adapter, ctx);
  }

  // Get retry config
  const retryConfig = getRetryConfig(adapter);

  // Convert to base executor format
  const requestConfig = {
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: typeof req.body === 'string' ? req.body : req.body ? JSON.stringify(req.body) : undefined,
  };

  try {
    const result = await baseExecuteRequest(requestConfig, verbose || false, retryConfig);

    // Build response object
    let res: AdapterResponse = {
      status: result.status,
      headers: {},
      data: result.data,
    };

    // Run afterResponse hook
    if (adapter.hooks?.afterResponse) {
      res = await adapter.hooks.afterResponse(res, ctx);
    }

    // Handle error responses
    if (res.status >= 400) {
      handleError(res.status, res.data, adapter, ctx);
    }

    // Apply response configuration
    const data = applyResponseConfig(res.data, adapter, ctx);

    return { status: res.status, data };
  } catch (error) {
    // Run onError hook
    if (adapter.hooks?.onError) {
      await adapter.hooks.onError(error as Error, ctx);
    }
    throw error;
  }
}

/**
 * Check if adapter has pagination configured
 */
export function hasPagination(adapter: ResolvedAdapter): boolean {
  return !!adapter.pagination;
}

/**
 * Get next page parameters from response
 */
export function getNextPageParams(
  adapter: ResolvedAdapter,
  response: unknown,
  ctx: AdapterContext
): Record<string, string> | null {
  const config = adapter.pagination;
  if (!config) return null;

  switch (config.style) {
    case 'cursor':
      if (config.cursor) {
        const hasMore = config.cursor.hasMore(response);
        if (!hasMore) return null;
        const cursor = config.cursor.extract(response);
        if (!cursor) return null;
        return { [config.cursor.param]: cursor };
      }
      break;

    case 'offset':
      if (config.offset) {
        const hasMore = config.offset.hasMore(response, ctx);
        if (!hasMore) return null;
        const offset = config.offset.extract(response, ctx);
        return { [config.offset.param]: String(offset) };
      }
      break;

    case 'page':
      if (config.page) {
        const hasMore = config.page.hasMore(response);
        if (!hasMore) return null;
        const page = config.page.extract(response, ctx);
        return { [config.page.param]: String(page) };
      }
      break;

    case 'link':
      // Link header pagination would need access to response headers
      // For now, return null - would need response headers passed in
      break;

    case 'custom':
      if (config.custom) {
        return config.custom.getNext(response, ctx);
      }
      break;
  }

  return null;
}
