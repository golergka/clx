# clx Specs System

## Overview

Every API in clx consists of two parts:

**In the repo, bundled in build:**
```
src/specs/
  stripe.ts      # Adapter — small, mostly defaults
  github.ts
  index.ts       # Registry — must modify to add API
```

**In the repo, NOT bundled (downloaded at install time):**
```
registry/
  stripe/
    openapi.yaml   # Original spec, verbatim from source
    .source.yaml   # Provenance metadata
  github/
    openapi.yaml
    .source.yaml
```

**On user's machine after install:**
```
~/.clx/
  specs/
    stripe.yaml    # Downloaded from clx repo
    github.yaml
```

The framework has zero hardcoded API-specific logic. All behavior comes from adapters.

## How It Works

1. User runs `clx install stripe`
2. clx looks up `stripe` in bundled adapters (`src/specs/stripe.ts`)
3. Downloads spec from `https://raw.githubusercontent.com/clx-dev/clx/main/registry/stripe/openapi.yaml`
4. Saves to `~/.clx/specs/stripe.yaml`
5. Creates symlink `~/.clx/bin/stripe -> clx`

**Adding a new API requires:**
- Adding `src/specs/newapi.ts` (adapter)
- Adding export to `src/specs/index.ts` (registry)
- Adding `registry/newapi/openapi.yaml` (spec, not bundled)

The first two are code changes → AGPL applies.

---

## Adapter Files

Adapters are small TypeScript files. Most APIs need minimal configuration — the framework handles everything from the OpenAPI spec.

```typescript
// src/specs/stripe.ts
import { defineAdapter } from '../core';

export default defineAdapter({
  name: 'stripe',
  auth: {
    type: 'bearer',
    envVar: 'STRIPE_API_KEY',
  },
});
```

That's it for most APIs. The framework infers everything else from the downloaded spec.

### Overrides

For APIs with quirks, add only what's needed:

```typescript
// src/specs/stripe.ts
import { defineAdapter } from '../core';

export default defineAdapter({
  name: 'stripe',
  auth: {
    type: 'bearer',
    envVar: 'STRIPE_API_KEY',
  },
  // Stripe uses form encoding, not JSON
  request: {
    contentType: 'application/x-www-form-urlencoded',
  },
  // Stripe pagination is cursor-based
  pagination: {
    style: 'cursor',
    param: 'starting_after',
    hasMore: (res) => res.has_more,
  },
});
```

### Registry Index

```typescript
// src/specs/index.ts
// This file must be modified to add new APIs

export { default as stripe } from './stripe';
export { default as github } from './github';
export { default as openai } from './openai';
// ...
```

---

## Adapter Schema

### Basic Info

```typescript
defineAdapter({
  // Identifier used in CLI (clx install stripe, stripe customers list)
  // Also determines spec download path: registry/{name}/openapi.yaml
  name: 'stripe',
  
  // Display name for help/docs (optional, defaults to capitalized name)
  displayName: 'Stripe',
});
```

### Base URL

```typescript
defineAdapter({
  // Static override
  baseUrl: 'https://api.stripe.com',
  
  // Or dynamic based on environment/profile
  baseUrl: (ctx) => {
    if (ctx.profile === 'sandbox') return 'https://sandbox.api.stripe.com';
    return 'https://api.stripe.com';
  },
  
  // Or use spec's servers[0].url (default behavior)
});
```

### Authentication

```typescript
defineAdapter({
  auth: {
    // Type: 'bearer' | 'basic' | 'apiKey' | 'oauth2' | 'custom'
    type: 'bearer',
    
    // Environment variable to check (before auth file)
    envVar: 'STRIPE_API_KEY',
    
    // How to prompt user during `clx auth login stripe`
    login: {
      prompt: 'Enter your Stripe API key:',
      hint: 'Find it at https://dashboard.stripe.com/apikeys',
      validate: (key) => key.startsWith('sk_'),
      errorMessage: 'Stripe keys start with sk_',
    },
    
    // How to apply auth to requests
    apply: (req, credential) => {
      req.headers['Authorization'] = `Bearer ${credential}`;
    },
  },
});
```

**Auth type shortcuts:**

```typescript
// Bearer token (most common)
auth: {
  type: 'bearer',
  envVar: 'STRIPE_API_KEY',
}
// Applies: Authorization: Bearer <token>

// API Key in header
auth: {
  type: 'apiKey',
  envVar: 'OPENAI_API_KEY',
  header: 'X-API-Key',
}
// Applies: X-API-Key: <token>

// API Key in query param
auth: {
  type: 'apiKey',
  envVar: 'SOME_API_KEY',
  query: 'api_key',
}
// Applies: ?api_key=<token>

// Basic auth
auth: {
  type: 'basic',
  envVar: 'TWILIO_CREDENTIALS', // format: "user:pass" or just check both vars
  envVarUser: 'TWILIO_ACCOUNT_SID',
  envVarPass: 'TWILIO_AUTH_TOKEN',
}
// Applies: Authorization: Basic base64(user:pass)

// OAuth2
auth: {
  type: 'oauth2',
  envVar: 'GITHUB_TOKEN',
  oauth: {
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'user'],
    clientId: process.env.CLX_GITHUB_CLIENT_ID,
  },
}

// Fully custom
auth: {
  type: 'custom',
  envVar: 'AWS_ACCESS_KEY_ID',
  apply: (req, credential, ctx) => {
    // Full control - e.g., AWS Signature v4
    const signature = signAWS(req, credential, ctx.secrets.AWS_SECRET_ACCESS_KEY);
    req.headers['Authorization'] = signature;
  },
  login: {
    prompts: [
      { name: 'accessKeyId', prompt: 'AWS Access Key ID:' },
      { name: 'secretAccessKey', prompt: 'AWS Secret Access Key:', secret: true },
      { name: 'region', prompt: 'Region:', default: 'us-east-1' },
    ],
  },
}
```

### Command Mapping

OpenAPI uses operationIds. clx needs a CLI hierarchy.

```typescript
defineAdapter({
  commands: {
    // Auto-generate from operationId patterns (default)
    mode: 'auto',
    
    // Or explicit mapping
    mode: 'manual',
    map: {
      'ListCustomers': 'customers list',
      'CreateCustomer': 'customers create',
      'RetrieveCustomer': 'customers get',
      'DeleteCustomer': 'customers delete',
    },
    
    // Or transform function
    mode: 'transform',
    transform: (operationId) => {
      // 'ListCustomers' -> 'customers list'
      const match = operationId.match(/^(List|Create|Get|Update|Delete)(.+)$/);
      if (match) {
        const [, verb, resource] = match;
        const action = verb.toLowerCase();
        const noun = pluralize(resource).toLowerCase();
        return `${noun} ${action === 'list' ? 'list' : action}`;
      }
      return operationId.toLowerCase();
    },
  },
});
```

**Auto mode patterns:**

The framework tries these patterns in order:

```
ListCustomers     -> customers list
CreateCustomer    -> customers create  
GetCustomer       -> customers get
customersList     -> customers list
customers_list    -> customers list
list-customers    -> customers list
GET /customers    -> customers list (from path + method)
```

### Parameter Mapping

Map CLI flags to API parameters.

```typescript
defineAdapter({
  parameters: {
    // Global renames (all operations)
    rename: {
      'starting_after': 'after',
      'ending_before': 'before',
    },
    
    // Global aliases
    alias: {
      'l': 'limit',
      'q': 'query',
    },
    
    // Per-operation overrides
    operations: {
      'customers list': {
        rename: { 'email': 'e' },
        defaults: { limit: 10 },
        hidden: ['expand'], // Don't show in --help
      },
    },
  },
});
```

### Request Transformation

Modify requests before sending.

```typescript
defineAdapter({
  request: {
    // Add headers to all requests
    headers: {
      'Stripe-Version': '2024-01-15',
      'User-Agent': 'clx/1.0.0',
    },
    
    // Dynamic headers
    headers: (ctx) => ({
      'Stripe-Version': ctx.config.apiVersion || '2024-01-15',
      'Idempotency-Key': ctx.flags.idempotencyKey,
    }),
    
    // Transform body before sending
    transformBody: (body, ctx) => {
      // Stripe uses form encoding for nested objects
      return flattenToFormData(body);
    },
    
    // Transform the entire request
    transform: (req, ctx) => {
      // Full control over method, url, headers, body
      return req;
    },
  },
});
```

### Response Transformation

Modify responses before outputting.

```typescript
defineAdapter({
  response: {
    // Extract data from wrapper
    unwrap: (res) => res.data,
    
    // Or path-based
    unwrap: 'data',
    
    // Transform response shape
    transform: (res, ctx) => {
      // e.g., normalize pagination
      return {
        items: res.data,
        hasMore: res.has_more,
        cursor: res.data[res.data.length - 1]?.id,
      };
    },
    
    // Handle specific status codes
    handlers: {
      404: (res, ctx) => {
        throw new NotFoundError(`${ctx.resource} not found`);
      },
    },
  },
});
```

### Pagination

```typescript
defineAdapter({
  pagination: {
    // Style: 'cursor' | 'offset' | 'page' | 'link' | 'custom'
    style: 'cursor',
    
    // Cursor-based (Stripe, etc.)
    cursor: {
      param: 'starting_after',        // Query param to set
      extract: (res) => res.data[res.data.length - 1]?.id,
      hasMore: (res) => res.has_more,
    },
    
    // Offset-based
    offset: {
      param: 'offset',
      limitParam: 'limit',
      extract: (res, ctx) => ctx.offset + res.items.length,
      hasMore: (res, ctx) => res.items.length === ctx.limit,
    },
    
    // Page-based
    page: {
      param: 'page',
      extract: (res, ctx) => ctx.page + 1,
      hasMore: (res) => res.page < res.totalPages,
    },
    
    // Link header (GitHub)
    link: {
      // Parses Link header automatically
      rel: 'next',
    },
    
    // Fully custom
    custom: {
      getNext: (res, ctx) => {
        // Return params for next request, or null if done
        if (!res.nextPageToken) return null;
        return { pageToken: res.nextPageToken };
      },
    },
  },
});
```

### Rate Limiting

```typescript
defineAdapter({
  rateLimit: {
    // Simple: requests per second
    rps: 10,
    
    // Or read from response headers
    headers: {
      limit: 'X-RateLimit-Limit',
      remaining: 'X-RateLimit-Remaining',
      reset: 'X-RateLimit-Reset',
    },
    
    // Retry behavior on 429
    retry: {
      maxRetries: 3,
      backoff: 'exponential', // or 'linear', 'fixed'
      initialDelay: 1000,
      maxDelay: 30000,
      // Or read from header
      retryAfterHeader: 'Retry-After',
    },
  },
});
```

### Timeouts

```typescript
defineAdapter({
  timeout: {
    connect: 5000,    // Connection timeout ms
    request: 30000,   // Total request timeout ms
    
    // Per-operation overrides
    operations: {
      'reports generate': { request: 120000 },
    },
  },
});
```

### Content Types

```typescript
defineAdapter({
  content: {
    // Default request content type
    requestType: 'application/json',
    
    // Or form-encoded (Stripe)
    requestType: 'application/x-www-form-urlencoded',
    
    // Per-operation
    operations: {
      'files upload': { 
        requestType: 'multipart/form-data',
      },
    },
    
    // Response parsing
    responseType: 'json', // 'json' | 'text' | 'binary' | 'auto'
  },
});
```

### Error Mapping

```typescript
defineAdapter({
  errors: {
    // Extract error message from response body
    extract: (body) => ({
      message: body.error?.message || body.message,
      code: body.error?.code,
      type: body.error?.type,
    }),
    
    // Or path-based
    messagePath: 'error.message',
    codePath: 'error.code',
    
    // Map API errors to CLI exit codes
    exitCodes: {
      'authentication_error': 4,
      'invalid_request_error': 2,
      'rate_limit_error': 3,
    },
  },
});
```

### Profiles

Multi-account/environment support.

```typescript
defineAdapter({
  profiles: {
    // Allow multiple auth profiles
    enabled: true,
    
    // Default profile name
    default: 'default',
    
    // Profile-specific settings
    settings: ['apiVersion', 'baseUrl'],
  },
});
```

Usage:
```bash
clx auth login stripe --profile production
clx auth login stripe --profile sandbox

stripe customers list --profile sandbox
```

### Hooks

```typescript
defineAdapter({
  hooks: {
    // Before any request
    beforeRequest: async (req, ctx) => {
      console.debug(`→ ${req.method} ${req.url}`);
      return req;
    },
    
    // After any response
    afterResponse: async (res, ctx) => {
      console.debug(`← ${res.status} (${res.timing}ms)`);
      return res;
    },
    
    // On error
    onError: async (err, ctx) => {
      if (err.status === 401) {
        console.error('Re-authenticate: clx auth login stripe');
      }
      throw err;
    },
    
    // After auth login
    afterLogin: async (credential, ctx) => {
      // Validate credential works
      const res = await ctx.request('GET', '/v1/account');
      console.log(`Authenticated as ${res.email}`);
    },
  },
});
```

### Help Customization

```typescript
defineAdapter({
  help: {
    // Description shown in `clx list`
    summary: 'Stripe payment processing API',
    
    // Shown in `stripe --help`
    description: 'Manage payments, customers, subscriptions, and more.',
    
    // Links
    docs: 'https://stripe.com/docs/api',
    dashboard: 'https://dashboard.stripe.com',
    
    // Examples shown in help
    examples: [
      { cmd: 'stripe customers list --limit 10', desc: 'List recent customers' },
      { cmd: 'stripe customers create --email user@example.com', desc: 'Create a customer' },
    ],
    
    // Customize parameter descriptions (override spec)
    parameters: {
      'limit': 'Maximum number of results (1-100)',
    },
  },
});
```

---

## Complete Example: Stripe

```typescript
// src/specs/stripe.ts
import { defineAdapter } from '../core';

export default defineAdapter({
  name: 'stripe',
  displayName: 'Stripe',
  
  baseUrl: 'https://api.stripe.com',
  
  auth: {
    type: 'bearer',
    envVar: 'STRIPE_API_KEY',
    login: {
      prompt: 'Enter your Stripe secret key:',
      hint: 'Get it from https://dashboard.stripe.com/apikeys',
      validate: (key) => key.startsWith('sk_'),
      errorMessage: 'Stripe secret keys start with sk_',
    },
  },
  
  request: {
    headers: (ctx) => ({
      'Stripe-Version': '2024-01-15',
    }),
    // Stripe uses form encoding, not JSON
    transformBody: (body) => flattenToFormData(body),
  },
  
  content: {
    requestType: 'application/x-www-form-urlencoded',
  },
  
  response: {
    unwrap: (res) => res, // Stripe responses are already clean
  },
  
  pagination: {
    style: 'cursor',
    cursor: {
      param: 'starting_after',
      extract: (res) => res.data?.[res.data.length - 1]?.id,
      hasMore: (res) => res.has_more,
    },
  },
  
  parameters: {
    alias: {
      'l': 'limit',
    },
    rename: {
      'starting_after': 'after',
      'ending_before': 'before',
    },
  },
  
  rateLimit: {
    headers: {
      limit: 'X-RateLimit-Limit',
      remaining: 'X-RateLimit-Remaining',
    },
    retry: {
      maxRetries: 3,
      backoff: 'exponential',
    },
  },
  
  errors: {
    extract: (body) => ({
      message: body.error?.message,
      code: body.error?.code,
      type: body.error?.type,
    }),
  },
  
  help: {
    summary: 'Stripe payment processing API',
    docs: 'https://stripe.com/docs/api',
    examples: [
      { cmd: 'stripe customers list', desc: 'List customers' },
      { cmd: 'stripe charges create --amount 2000 --currency usd --source tok_visa', desc: 'Create a charge' },
    ],
  },
});
```

---

## Complete Example: GitHub

```typescript
// src/specs/github.ts
import { defineAdapter } from '../core';

export default defineAdapter({
  name: 'github',
  displayName: 'GitHub',
  
  baseUrl: 'https://api.github.com',
  
  auth: {
    type: 'bearer',
    envVar: 'GITHUB_TOKEN',
    login: {
      prompt: 'Enter your GitHub personal access token:',
      hint: 'Create one at https://github.com/settings/tokens',
    },
  },
  
  request: {
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  },
  
  pagination: {
    style: 'link',
    link: {
      rel: 'next',
    },
  },
  
  rateLimit: {
    headers: {
      limit: 'X-RateLimit-Limit',
      remaining: 'X-RateLimit-Remaining',
      reset: 'X-RateLimit-Reset',
    },
  },
  
  commands: {
    mode: 'transform',
    transform: (operationId) => {
      // GitHub uses 'repos/list' style
      return operationId.replace(/\//g, ' ').replace(/-/g, ' ');
    },
  },
  
  errors: {
    messagePath: 'message',
  },
  
  help: {
    summary: 'GitHub REST API',
    docs: 'https://docs.github.com/en/rest',
  },
});
```

---

## Minimal Example

Most adapters can be tiny if the API is well-behaved:

```typescript
// src/specs/petstore.ts
import { defineAdapter } from '../core';

export default defineAdapter({
  name: 'petstore',
  auth: {
    type: 'apiKey',
    header: 'api_key',
    envVar: 'PETSTORE_API_KEY',
  },
});
```

Framework defaults handle everything else.

---

## Spec Source Management

OpenAPI specs live in `registry/` folder (not bundled in build).

### `.source.yaml`

Every spec has a source manifest:

```yaml
# registry/stripe/.source.yaml
name: stripe
source:
  url: https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.yaml
retrieved: 2025-01-15T10:30:00Z
sha256: a1b2c3d4e5f6...
size: 3145728
```

### Update Script

```bash
# Update single spec
./scripts/update-spec.ts stripe

# Update all specs
./scripts/update-spec.ts --all

# Check for updates without downloading
./scripts/update-spec.ts --check
```

```typescript
// scripts/update-spec.ts
import { specs } from '../src/specs';
import { loadSourceManifest, fetchSpec, computeHash } from './utils';

async function updateSpec(name: string) {
  const manifest = loadSourceManifest(name);
  const content = await fetchSpec(manifest.source);
  const hash = computeHash(content);
  
  if (hash === manifest.sha256) {
    console.log(`${name}: up to date`);
    return;
  }
  
  writeFile(`registry/${name}/openapi.yaml`, content);
  writeFile(`registry/${name}/.source.yaml`, {
    ...manifest,
    retrieved: new Date().toISOString(),
    sha256: hash,
    size: content.length,
  });
  
  console.log(`${name}: updated`);
}
```

---

## Framework Defaults

When adapter omits config, framework uses these defaults:

```typescript
const DEFAULTS = {
  baseUrl: null,                    // From spec's servers[0].url
  auth: null,                       // From spec's securitySchemes
  
  commands: { mode: 'auto' },       // Infer from operationId
  parameters: {},                   // No renames/aliases
  
  request: {
    headers: {},
    transformBody: null,            // Pass through
  },
  
  response: {
    unwrap: null,                   // Return full response
    transform: null,
  },
  
  content: {
    requestType: 'application/json',
    responseType: 'auto',
  },
  
  pagination: null,                 // No auto-pagination
  rateLimit: null,                  // No rate limit handling
  
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
  
  help: {
    summary: null,                  // From spec's info.description
    docs: null,                     // From spec's externalDocs.url
  },
};
```

---

## Type Safety

Full TypeScript types for adapter config:

```typescript
// src/core/types.ts

export interface AdapterConfig {
  name: string;
  displayName?: string;
  
  baseUrl?: string | ((ctx: Context) => string);
  
  auth?: AuthConfig;
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

export function defineAdapter(config: AdapterConfig): AdapterConfig {
  return config;
}
```

Adapters get full autocomplete and type checking.