// Adapter loader - resolves and loads API adapters
// Adapters are bundled in src/specs/, specs are downloaded at install time

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import YAML from 'yaml';
import type { OpenAPISpec } from './types.js';
import type { AdapterConfig, ResolvedAdapter } from './core/index.js';
import { resolveAdapterConfig } from './core/index.js';

// Import bundled adapters
import * as bundledAdapters from './specs/index.js';

// Cache for loaded adapters
const adapterCache = new Map<string, ResolvedAdapter>();

// GitHub raw URL for downloading specs
const SPEC_BASE_URL = 'https://raw.githubusercontent.com/golergka/clx/main/registry';

/**
 * Get user's clx directory (defaults to ~/.clx)
 */
export function getClxDir(): string {
  return process.env.CLX_HOME || path.join(os.homedir(), '.clx');
}

/**
 * Get user's specs directory
 */
export function getUserSpecsDir(): string {
  return path.join(getClxDir(), 'specs');
}

/**
 * Get user's bin directory
 */
export function getUserBinDir(): string {
  return process.env.CLX_BIN || path.join(getClxDir(), 'bin');
}

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
 * Load OpenAPI spec from user's specs directory
 */
function loadUserSpec(name: string): OpenAPISpec | null {
  const specsDir = getUserSpecsDir();
  const specPath = path.join(specsDir, `${name}.yaml`);

  if (!fs.existsSync(specPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(specPath, 'utf-8');
    return YAML.parse(content) as OpenAPISpec;
  } catch {
    return null;
  }
}

/**
 * Download and save spec from clx repo
 */
export async function downloadSpec(name: string): Promise<boolean> {
  const url = `${SPEC_BASE_URL}/${name}/openapi.yaml`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();

    // Ensure specs directory exists
    const specsDir = getUserSpecsDir();
    if (!fs.existsSync(specsDir)) {
      fs.mkdirSync(specsDir, { recursive: true });
    }

    // Save spec
    const specPath = path.join(specsDir, `${name}.yaml`);
    fs.writeFileSync(specPath, content);

    return true;
  } catch (err) {
    console.error(`Failed to download spec: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * Check if spec is installed (downloaded) for an API
 */
export function isSpecInstalled(name: string): boolean {
  const specsDir = getUserSpecsDir();
  const specPath = path.join(specsDir, `${name}.yaml`);
  return fs.existsSync(specPath);
}

/**
 * Remove installed spec
 */
export function removeSpec(name: string): boolean {
  const specsDir = getUserSpecsDir();
  const specPath = path.join(specsDir, `${name}.yaml`);

  if (fs.existsSync(specPath)) {
    fs.unlinkSync(specPath);
    return true;
  }
  return false;
}

/**
 * Load and resolve an adapter by name.
 * Requires a bundled adapter config and a downloaded spec.
 */
export function loadAdapter(name: string): ResolvedAdapter | null {
  // Check cache first
  if (adapterCache.has(name)) {
    return adapterCache.get(name)!;
  }

  // Must have a bundled adapter
  const adapterConfig = getBundledAdapter(name);
  if (!adapterConfig) {
    return null;
  }

  // Load spec from user's specs directory
  const spec = loadUserSpec(name);
  if (!spec) {
    return null;
  }

  // Resolve config with defaults
  const resolvedConfig = resolveAdapterConfig(adapterConfig);

  const resolved: ResolvedAdapter = {
    ...resolvedConfig,
    specData: spec,
  };

  // Cache it
  adapterCache.set(name, resolved);

  return resolved;
}

// Validate if a string is a valid absolute URL
function isValidAbsoluteUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the base URL for an adapter
 */
export function getAdapterBaseUrl(adapter: ResolvedAdapter, ctx?: { profile?: string; config?: Record<string, unknown> }): string | null {
  // Static or dynamic baseUrl from adapter
  if (adapter.baseUrl) {
    if (typeof adapter.baseUrl === 'function') {
      const url = adapter.baseUrl(ctx || {});
      return url && isValidAbsoluteUrl(url) ? url.replace(/\/$/, '') : null;
    }
    return isValidAbsoluteUrl(adapter.baseUrl) ? adapter.baseUrl.replace(/\/$/, '') : null;
  }

  // Fall back to spec's servers - but only if it's an absolute URL
  const servers = adapter.specData.servers;
  if (servers && servers.length > 0) {
    let url = servers[0].url;

    // Resolve server variables
    const variables = servers[0].variables;
    if (variables) {
      for (const [key, variable] of Object.entries(variables)) {
        const value = variable.default || (variable.enum ? variable.enum[0] : '');
        url = url.replace(`{${key}}`, value);
      }
    }

    // Only return if it's a valid absolute URL
    if (isValidAbsoluteUrl(url)) {
      return url.replace(/\/$/, '');
    }
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
 * List all installed APIs (have both adapter and downloaded spec)
 */
export function listInstalledApis(): string[] {
  const bundled = getBundledAdapterNames();
  return bundled.filter(name => isSpecInstalled(name));
}

/**
 * List all available APIs (bundled adapters, whether installed or not)
 */
export function listAvailableApis(): string[] {
  return getBundledAdapterNames();
}
