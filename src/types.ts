// OpenAPI 3.x type definitions

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{
    url: string;
    description?: string;
    variables?: Record<string, { default: string; enum?: string[] }>;
  }>;
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, Schema>;
    securitySchemes?: Record<string, SecurityScheme>;
    parameters?: Record<string, Parameter>;
    requestBodies?: Record<string, RequestBody>;
  };
  security?: Array<Record<string, string[]>>;
}

export interface PathItem {
  get?: Operation;
  post?: Operation;
  put?: Operation;
  patch?: Operation;
  delete?: Operation;
  parameters?: Parameter[];
  summary?: string;
  description?: string;
}

export interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: RequestBody | Reference;
  responses: Record<string, Response | Reference>;
  security?: Array<Record<string, string[]>>;
  deprecated?: boolean;
}

export interface Parameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  schema?: Schema;
  style?: string;
  explode?: boolean;
}

export interface RequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, MediaType>;
}

export interface MediaType {
  schema?: Schema;
  example?: unknown;
  examples?: Record<string, unknown>;
}

export interface Response {
  description: string;
  content?: Record<string, MediaType>;
  headers?: Record<string, Parameter>;
}

export interface Schema {
  type?: string;
  format?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  enum?: unknown[];
  description?: string;
  default?: unknown;
  $ref?: string;
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface Reference {
  $ref: string;
}

export interface SecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
  description?: string;
  name?: string;
  in?: 'query' | 'header' | 'cookie';
  scheme?: string;
  bearerFormat?: string;
  flows?: OAuthFlows;
  openIdConnectUrl?: string;
}

export interface OAuthFlows {
  implicit?: OAuthFlow;
  password?: OAuthFlow;
  clientCredentials?: OAuthFlow;
  authorizationCode?: OAuthFlow;
}

export interface OAuthFlow {
  authorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
}

// Single auth profile
export interface AuthProfile {
  type: 'apiKey' | 'bearer' | 'basic' | 'oauth2';
  apiKey?: string;
  apiKeyHeader?: string;
  apiKeyQuery?: string;
  bearerToken?: string;
  username?: string;
  password?: string;
  oauth2?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    tokenUrl?: string;
    refreshUrl?: string;
    clientId?: string;
    clientSecret?: string;
    scopes?: string[];
  };
  // Custom config from adapter login prompts (e.g., domain for Atlassian)
  config?: Record<string, unknown>;
}

// Auth configuration stored in ~/.config/clx/auth/<api>.json
// Supports multiple profiles per API
export interface AuthConfig {
  // Default profile name
  defaultProfile: string;
  // Map of profile name to profile config
  profiles: Record<string, AuthProfile>;
}

// Legacy format (single profile) - for backwards compatibility
export interface LegacyAuthConfig {
  type: 'apiKey' | 'bearer' | 'basic' | 'oauth2';
  apiKey?: string;
  apiKeyHeader?: string;
  apiKeyQuery?: string;
  bearerToken?: string;
  username?: string;
  password?: string;
  oauth2?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    tokenUrl?: string;
    clientId?: string;
    clientSecret?: string;
  };
}

// Command tree structure derived from OpenAPI paths
export interface CommandNode {
  name: string;
  description?: string;
  children: Map<string, CommandNode>;
  operations: Map<string, OperationInfo>;
}

export interface OperationInfo {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  operation: Operation;
  pathParameters: Parameter[];
  /** All resolved parameters (path + operation level, with refs resolved) */
  resolvedParameters?: Parameter[];
}

// CLI execution context
export interface ExecutionContext {
  apiName: string;
  spec: OpenAPISpec;
  auth?: AuthProfile;
  baseUrl: string;
  dryRun: boolean;
  verbose: boolean;
  profileName?: string;
}
