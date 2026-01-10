// Adapter loader - resolves and loads API adapters
// Supports both bundled adapters (src/specs/) and user-installed specs (~/.config/clx/specs/)

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import type { OpenAPISpec } from './types.js';
import type { AdapterConfig, ResolvedAdapter } from './adapter.js';
import { resolveAdapterConfig, ADAPTER_DEFAULTS } from './adapter.js';
import { getSpecsDir, loadSpec as loadUserSpec } from './config.js';

// Import bundled adapters
import * as bundledAdapters from './specs/index.js';

// Cache for loaded adapters
const adapterCache = new Map<string, ResolvedAdapter>();

/**
 * Get list of all bundled adapter names
 */
export function getBundledAdapterNames(): string[] {
  return Object.keys(bundledAdapters);
}

/**
 * Get a bundled adapter config by name
 */
export function getBundledAdapter(name: string): AdapterConfig | null {
  const adapters = bundledAdapters as Record<string, AdapterConfig>;
  return adapters[name] || null;
}

/**
 * Check if an API has a bundled adapter
 */
export function hasBundledAdapter(name: string): boolean {
  return name in bundledAdapters;
}

/**
 * Load OpenAPI spec from bundled adapter's directory
 */
function loadBundledSpec(adapterConfig: AdapterConfig): OpenAPISpec | null {
  // The spec path is relative to the adapter file
  // Since adapters are at src/specs/{name}/adapter.ts
  // and specs are at src/specs/{name}/openapi.yaml
  // We need to resolve this at runtime

  // For bundled specs, we look in the dist or src directory
  const possiblePaths = [
    // Development: relative to project root
    path.join(process.cwd(), 'src', 'specs', adapterConfig.name, 'openapi.yaml'),
    // Built: check if spec was copied
    path.join(__dirname, 'specs', adapterConfig.name, 'openapi.yaml'),
  ];

  for (const specPath of possiblePaths) {
    if (fs.existsSync(specPath)) {
      try {
        const content = fs.readFileSync(specPath, 'utf-8');
        return YAML.parse(content) as OpenAPISpec;
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Create a synthetic adapter config for user-installed specs
 * (specs that don't have a bundled adapter)
 */
function createSyntheticAdapter(name: string, spec: OpenAPISpec): AdapterConfig {
  return {
    name,
    spec: `./${name}.yaml`,
    displayName: spec.info.title,
    version: spec.info.version,
    // Auto-detect auth from spec's securitySchemes
    auth: inferAuthFromSpec(spec),
    help: {
      summary: spec.info.description?.slice(0, 100) || spec.info.title,
    },
  };
}

/**
 * Infer auth configuration from OpenAPI spec's securitySchemes
 */
function inferAuthFromSpec(spec: OpenAPISpec): AdapterConfig['auth'] | undefined {
  const schemes = spec.components?.securitySchemes;
  if (!schemes) return undefined;

  // Find the first usable security scheme
  for (const [name, scheme] of Object.entries(schemes)) {
    if (scheme.type === 'http' && scheme.scheme === 'bearer') {
      return {
        type: 'bearer',
        login: {
          prompt: `Enter your ${spec.info.title} API token:`,
        },
      };
    }

    if (scheme.type === 'apiKey') {
      return {
        type: 'apiKey',
        header: scheme.in === 'header' ? scheme.name : undefined,
        query: scheme.in === 'query' ? scheme.name : undefined,
        login: {
          prompt: `Enter your ${spec.info.title} API key:`,
        },
      };
    }

    if (scheme.type === 'oauth2') {
      const flows = scheme.flows;
      const flow = flows?.authorizationCode || flows?.clientCredentials || flows?.implicit;
      if (flow) {
        return {
          type: 'oauth2',
          oauth: {
            authorizationUrl: flow.authorizationUrl || '',
            tokenUrl: flow.tokenUrl || '',
            scopes: Object.keys(flow.scopes || {}),
          },
        };
      }
    }
  }

  return undefined;
}

/**
 * Load and resolve an adapter by name.
 * Checks bundled adapters first, then falls back to user-installed specs.
 */
export function loadAdapter(name: string): ResolvedAdapter | null {
  // Check cache first
  if (adapterCache.has(name)) {
    return adapterCache.get(name)!;
  }

  let adapterConfig: AdapterConfig;
  let spec: OpenAPISpec | null = null;
  let specPath: string;

  // Try bundled adapter first
  const bundled = getBundledAdapter(name);
  if (bundled) {
    adapterConfig = bundled;
    spec = loadBundledSpec(bundled);

    if (!spec) {
      // Bundled adapter exists but spec not found - might need to run update-spec
      // Fall through to try user-installed
    } else {
      specPath = path.join('src', 'specs', name, 'openapi.yaml');
    }
  }

  // If no bundled spec, try user-installed
  if (!spec) {
    spec = loadUserSpec(name);
    if (!spec) {
      return null;
    }
    specPath = path.join(getSpecsDir(), `${name}.yaml`);

    // Use bundled adapter config if exists, otherwise create synthetic
    if (bundled) {
      adapterConfig = bundled;
    } else {
      adapterConfig = createSyntheticAdapter(name, spec);
    }
  }

  // Resolve config with defaults
  const resolvedConfig = resolveAdapterConfig(adapterConfig!);

  const resolved: ResolvedAdapter = {
    ...resolvedConfig,
    specData: spec,
    specPath: specPath!,
  };

  // Cache it
  adapterCache.set(name, resolved);

  return resolved;
}

/**
 * Get the base URL for an adapter
 */
export function getAdapterBaseUrl(adapter: ResolvedAdapter, ctx?: { profile?: string }): string | null {
  // Static or dynamic baseUrl from adapter
  if (adapter.baseUrl) {
    if (typeof adapter.baseUrl === 'function') {
      return adapter.baseUrl(ctx || {});
    }
    return adapter.baseUrl;
  }

  // Fall back to spec's servers
  const servers = adapter.specData.servers;
  if (servers && servers.length > 0) {
    return servers[0].url;
  }

  return null;
}

/**
 * Clear the adapter cache (for testing)
 */
export function clearAdapterCache(): void {
  adapterCache.clear();
}

/**
 * List all available APIs (bundled + user-installed)
 */
export function listAllAdapters(): string[] {
  const bundled = getBundledAdapterNames();

  // Get user-installed specs that aren't bundled
  const specsDir = getSpecsDir();
  let userInstalled: string[] = [];

  if (fs.existsSync(specsDir)) {
    userInstalled = fs.readdirSync(specsDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.json'))
      .map(f => f.replace(/\.(yaml|json)$/, ''))
      .filter(name => !bundled.includes(name));
  }

  return [...bundled, ...userInstalled].sort();
}
