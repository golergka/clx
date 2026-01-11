// Core module - adapter definition and types
// See docs/SPECS.md for full documentation

import type { OpenAPISpec, AuthProfile } from '../types.js';

// Context passed to dynamic adapter functions
export interface AdapterContext {
  profile?: string;
  config?: Record<string, unknown>;
  flags?: Map<string, string>;
  secrets?: Record<string, string>;
  offset?: number;
  limit?: number;
  page?: number;
  resource?: string;
}

// Request object for transformation
export interface AdapterRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}

// Response object for transformation
export interface AdapterResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
  timing?: number;
}

// Auth configuration
export interface AuthLoginPrompt {
  name?: string;
  prompt: string;
  hint?: string;
  secret?: boolean;
  default?: string;
  validate?: (value: string) => boolean;
  errorMessage?: string;
}

export interface AuthLoginConfig {
  prompt?: string;
  hint?: string;
  validate?: (value: string) => boolean;
  errorMessage?: string;
  prompts?: AuthLoginPrompt[];
}

export interface OAuthConfig {
  authorizationUrl: string;
  tokenUrl: string;
  scopes?: string[];
  clientId?: string;
  clientSecret?: string;
}

export interface AdapterAuthConfig {
  type: 'bearer' | 'basic' | 'apiKey' | 'oauth2' | 'custom';
  envVar?: string;
  envVarUser?: string;
  envVarPass?: string;
  header?: string;
  query?: string;
  login?: AuthLoginConfig;
  oauth?: OAuthConfig;
  apply?: (req: AdapterRequest, credential: string | Record<string, string>, ctx: AdapterContext) => void;
}

// Command mapping configuration
export interface CommandsConfig {
  mode?: 'auto' | 'manual' | 'transform';
  map?: Record<string, string>;
  transform?: (operationId: string) => string;
}

// Parameter configuration
export interface OperationParameterConfig {
  rename?: Record<string, string>;
  defaults?: Record<string, unknown>;
  hidden?: string[];
}

export interface ParametersConfig {
  rename?: Record<string, string>;
  alias?: Record<string, string>;
  operations?: Record<string, OperationParameterConfig>;
}

// Request transformation
export interface RequestConfig {
  headers?: Record<string, string> | ((ctx: AdapterContext) => Record<string, string>);
  contentType?: string;
  transformBody?: (body: unknown, ctx: AdapterContext) => unknown;
  transform?: (req: AdapterRequest, ctx: AdapterContext) => AdapterRequest;
}

// Response transformation
export interface ResponseConfig {
  unwrap?: string | ((res: unknown) => unknown);
  transform?: (res: unknown, ctx: AdapterContext) => unknown;
  handlers?: Record<number, (res: AdapterResponse, ctx: AdapterContext) => void>;
}

// Content type configuration
export interface ContentConfig {
  requestType?: 'application/json' | 'application/x-www-form-urlencoded' | 'multipart/form-data' | string;
  responseType?: 'json' | 'text' | 'binary' | 'auto';
  operations?: Record<string, { requestType?: string; responseType?: string }>;
}

// Pagination configuration
export interface CursorPaginationConfig {
  param: string;
  extract: (res: unknown) => string | null;
  hasMore: (res: unknown) => boolean;
}

export interface OffsetPaginationConfig {
  param: string;
  limitParam: string;
  extract: (res: unknown, ctx: AdapterContext) => number;
  hasMore: (res: unknown, ctx: AdapterContext) => boolean;
}

export interface PagePaginationConfig {
  param: string;
  extract: (res: unknown, ctx: AdapterContext) => number;
  hasMore: (res: unknown) => boolean;
}

export interface LinkPaginationConfig {
  rel: string;
}

export interface CustomPaginationConfig {
  getNext: (res: unknown, ctx: AdapterContext) => Record<string, string> | null;
}

export interface PaginationConfig {
  style: 'cursor' | 'offset' | 'page' | 'link' | 'custom';
  param?: string;
  hasMore?: (res: unknown) => boolean;
  cursor?: CursorPaginationConfig;
  offset?: OffsetPaginationConfig;
  page?: PagePaginationConfig;
  link?: LinkPaginationConfig;
  custom?: CustomPaginationConfig;
}

// Rate limiting configuration
export interface RateLimitHeaders {
  limit?: string;
  remaining?: string;
  reset?: string;
}

export interface RetryConfig {
  maxRetries?: number;
  backoff?: 'exponential' | 'linear' | 'fixed';
  initialDelay?: number;
  maxDelay?: number;
  retryAfterHeader?: string;
}

export interface RateLimitConfig {
  rps?: number;
  headers?: RateLimitHeaders;
  retry?: RetryConfig;
}

// Timeout configuration
export interface TimeoutConfig {
  connect?: number;
  request?: number;
  operations?: Record<string, { connect?: number; request?: number }>;
}

// Error mapping configuration
export interface ErrorExtract {
  message?: string;
  code?: string;
  type?: string;
}

export interface ErrorsConfig {
  extract?: (body: unknown) => ErrorExtract;
  messagePath?: string;
  codePath?: string;
  exitCodes?: Record<string, number>;
}

// Profiles configuration
export interface ProfilesConfig {
  enabled?: boolean;
  default?: string;
  settings?: string[];
}

// Hooks configuration
export interface HooksConfig {
  beforeRequest?: (req: AdapterRequest, ctx: AdapterContext) => Promise<AdapterRequest> | AdapterRequest;
  afterResponse?: (res: AdapterResponse, ctx: AdapterContext) => Promise<AdapterResponse> | AdapterResponse;
  onError?: (err: Error & { status?: number }, ctx: AdapterContext) => Promise<void> | void;
  afterLogin?: (credential: string | Record<string, string>, ctx: AdapterContext) => Promise<void> | void;
}

// Help customization
export interface HelpExample {
  cmd: string;
  desc: string;
}

export interface HelpConfig {
  summary?: string;
  description?: string;
  docs?: string;
  dashboard?: string;
  examples?: HelpExample[];
  parameters?: Record<string, string>;
}

// Main adapter configuration
export interface AdapterConfig {
  // Required
  name: string;

  // Optional basic info
  displayName?: string;

  // Base URL (static or dynamic)
  baseUrl?: string | ((ctx: AdapterContext) => string | null);

  // All other configuration
  auth?: AdapterAuthConfig;
  commands?: CommandsConfig;
  parameters?: ParametersConfig;
  request?: RequestConfig;
  response?: ResponseConfig;
  content?: ContentConfig;
  pagination?: PaginationConfig;
  rateLimit?: RateLimitConfig;
  timeout?: TimeoutConfig;
  errors?: ErrorsConfig;
  profiles?: ProfilesConfig;
  hooks?: HooksConfig;
  help?: HelpConfig;
}

// Resolved adapter with loaded spec
export interface ResolvedAdapter extends AdapterConfig {
  specData: OpenAPISpec;
}

// Framework defaults
export const ADAPTER_DEFAULTS: Partial<AdapterConfig> = {
  commands: { mode: 'auto' },
  parameters: {},
  request: {
    headers: {},
  },
  response: {},
  content: {
    requestType: 'application/json',
    responseType: 'auto',
  },
  timeout: {
    connect: 10000,
    request: 30000,
  },
  errors: {
    messagePath: 'message',
    codePath: 'code',
  },
  profiles: {
    enabled: true,
    default: 'default',
  },
};

/**
 * Define an adapter configuration.
 * This is the main entry point for creating API adapters.
 */
export function defineAdapter(config: AdapterConfig): AdapterConfig {
  return config;
}

/**
 * Merge adapter config with defaults
 */
export function resolveAdapterConfig(config: AdapterConfig): AdapterConfig {
  return {
    ...ADAPTER_DEFAULTS,
    ...config,
    commands: { ...ADAPTER_DEFAULTS.commands, ...config.commands },
    parameters: { ...ADAPTER_DEFAULTS.parameters, ...config.parameters },
    request: { ...ADAPTER_DEFAULTS.request, ...config.request },
    response: { ...ADAPTER_DEFAULTS.response, ...config.response },
    content: { ...ADAPTER_DEFAULTS.content, ...config.content },
    timeout: { ...ADAPTER_DEFAULTS.timeout, ...config.timeout },
    errors: { ...ADAPTER_DEFAULTS.errors, ...config.errors },
    profiles: { ...ADAPTER_DEFAULTS.profiles, ...config.profiles },
  };
}

/**
 * Get value at a dot-separated path from an object
 */
export function getAtPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current = obj as Record<string, unknown>;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = current[part] as Record<string, unknown>;
  }

  return current;
}

/**
 * Extract error info from response body using adapter config
 */
export function extractError(body: unknown, config: ErrorsConfig): ErrorExtract {
  if (config.extract) {
    return config.extract(body);
  }

  return {
    message: config.messagePath ? String(getAtPath(body, config.messagePath) || '') : undefined,
    code: config.codePath ? String(getAtPath(body, config.codePath) || '') : undefined,
  };
}

/**
 * Apply auth to request based on adapter config
 */
export function applyAuth(
  req: AdapterRequest,
  auth: AuthProfile,
  config: AdapterAuthConfig,
  ctx: AdapterContext
): void {
  // Custom apply function takes precedence
  if (config.apply) {
    const credential = auth.bearerToken || auth.apiKey || auth.oauth2?.accessToken || '';
    config.apply(req, credential, ctx);
    return;
  }

  switch (config.type) {
    case 'bearer':
      const bearerToken = auth.bearerToken || auth.apiKey || auth.oauth2?.accessToken;
      if (bearerToken) {
        req.headers['Authorization'] = `Bearer ${bearerToken}`;
      }
      break;

    case 'apiKey':
      const apiKey = auth.apiKey || auth.bearerToken;
      if (apiKey) {
        if (config.header) {
          req.headers[config.header] = apiKey;
        } else if (config.query) {
          if (!req.query) req.query = {};
          req.query[config.query] = apiKey;
        }
      }
      break;

    case 'basic':
      const username = auth.username || '';
      const password = auth.password || '';
      const credentials = Buffer.from(`${username}:${password}`).toString('base64');
      req.headers['Authorization'] = `Basic ${credentials}`;
      break;

    case 'oauth2':
      const token = auth.oauth2?.accessToken || auth.bearerToken;
      if (token) {
        req.headers['Authorization'] = `Bearer ${token}`;
      }
      break;

    case 'custom':
      // Must use apply function
      break;
  }
}

/**
 * Transform operationId to CLI command using auto mode
 */
export function autoTransformOperationId(operationId: string): string {
  // Try common patterns

  // ListCustomers, CreateCustomer, GetCustomer, UpdateCustomer, DeleteCustomer
  const verbNounMatch = operationId.match(/^(List|Create|Get|Retrieve|Update|Delete|Remove|Add|Find|Search)(.+)$/);
  if (verbNounMatch) {
    const [, verb, noun] = verbNounMatch;
    const action = verb.toLowerCase().replace('retrieve', 'get').replace('remove', 'delete').replace('add', 'create');
    const resource = noun.toLowerCase();
    return `${resource} ${action}`;
  }

  // customersList, customersCreate
  const camelMatch = operationId.match(/^([a-z]+)([A-Z][a-z]+)$/);
  if (camelMatch) {
    const [, resource, action] = camelMatch;
    return `${resource} ${action.toLowerCase()}`;
  }

  // customers_list, customers_create
  const snakeMatch = operationId.match(/^([a-z]+)_([a-z]+)$/);
  if (snakeMatch) {
    const [, resource, action] = snakeMatch;
    return `${resource} ${action}`;
  }

  // list-customers, create-customer
  const kebabMatch = operationId.match(/^([a-z]+)-([a-z]+)$/);
  if (kebabMatch) {
    const [, action, resource] = kebabMatch;
    return `${resource} ${action}`;
  }

  // Default: just lowercase
  return operationId.toLowerCase().replace(/[-_]/g, ' ');
}

/**
 * Transform operationId to CLI command based on config
 */
export function transformOperationId(operationId: string, config?: CommandsConfig): string {
  if (!config || config.mode === 'auto') {
    return autoTransformOperationId(operationId);
  }

  if (config.mode === 'manual' && config.map) {
    return config.map[operationId] || operationId.toLowerCase();
  }

  if (config.mode === 'transform' && config.transform) {
    return config.transform(operationId);
  }

  return operationId.toLowerCase();
}

/**
 * Flatten nested object to form data (for APIs like Stripe)
 */
export function flattenToFormData(
  obj: Record<string, unknown>,
  prefix: string = ''
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;

    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenToFormData(value as Record<string, unknown>, fullKey));
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'object') {
          Object.assign(result, flattenToFormData(item as Record<string, unknown>, `${fullKey}[${index}]`));
        } else {
          result[`${fullKey}[${index}]`] = String(item);
        }
      });
    } else {
      result[fullKey] = String(value);
    }
  }

  return result;
}
