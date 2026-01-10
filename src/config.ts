import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import YAML from 'yaml';
import type { OpenAPISpec, AuthConfig, AuthProfile, LegacyAuthConfig } from './types.js';

// Global config file structure
export interface ClxConfig {
  update_check?: boolean;
  output?: 'json' | 'table';
  color?: boolean;
  registry?: string;
  timeout?: number;
  apis?: Record<string, {
    base_url?: string;
    profile?: string;
  }>;
}

// Cache for loaded config
let configCache: ClxConfig | null = null;

// Get config directory - supports CLX_HOME override
export function getConfigDir(): string {
  // CLX_HOME takes precedence
  if (process.env.CLX_HOME) {
    return process.env.CLX_HOME;
  }
  // Then XDG standard
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return path.join(xdgConfig, 'clx');
  }
  // Default to ~/.config/clx (XDG compliant)
  return path.join(os.homedir(), '.config', 'clx');
}

export function getSpecsDir(): string {
  return path.join(getConfigDir(), 'specs');
}

export function getAuthDir(): string {
  return path.join(getConfigDir(), 'auth');
}

export function getBinDir(): string {
  // CLX_BIN takes precedence, then CLX_BIN_DIR for backwards compat
  if (process.env.CLX_BIN) {
    return process.env.CLX_BIN;
  }
  if (process.env.CLX_BIN_DIR) {
    return process.env.CLX_BIN_DIR;
  }
  return path.join(os.homedir(), '.local', 'bin');
}

// Load global config from config.toml
export function loadConfig(): ClxConfig {
  if (configCache) {
    return configCache;
  }

  const configPath = path.join(getConfigDir(), 'config.toml');

  if (!fs.existsSync(configPath)) {
    configCache = {};
    return configCache;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    // Simple TOML parser for our use case
    configCache = parseSimpleToml(content);
    return configCache;
  } catch {
    configCache = {};
    return configCache;
  }
}

// Simple TOML parser for config.toml (handles our specific format)
function parseSimpleToml(content: string): ClxConfig {
  const config: ClxConfig = {};
  const lines = content.split('\n');
  let currentSection = '';
  let currentApiName = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Section header
    if (trimmed.startsWith('[')) {
      const match = trimmed.match(/^\[([^\]]+)\]$/);
      if (match) {
        currentSection = match[1];
        // Handle [apis.stripe] format
        if (currentSection.startsWith('apis.')) {
          currentApiName = currentSection.substring(5);
          if (!config.apis) config.apis = {};
          config.apis[currentApiName] = {};
        }
      }
      continue;
    }

    // Key = value
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value: string | boolean | number = kvMatch[2].trim();

      // Parse value
      if (value === 'true') {
        value = true;
      } else if (value === 'false') {
        value = false;
      } else if (/^\d+$/.test(value)) {
        value = parseInt(value, 10);
      } else if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }

      // Set value based on section
      if (currentSection.startsWith('apis.') && config.apis && currentApiName) {
        (config.apis[currentApiName] as Record<string, unknown>)[key] = value;
      } else {
        (config as Record<string, unknown>)[key] = value;
      }
    }
  }

  return config;
}

// Get config value with environment variable override
export function getConfigValue<K extends keyof ClxConfig>(key: K): ClxConfig[K] | undefined {
  const config = loadConfig();

  // Check environment variable first
  const envKey = `CLX_${key.toUpperCase()}`;
  const envValue = process.env[envKey];
  if (envValue !== undefined) {
    if (key === 'update_check' || key === 'color') {
      return (envValue !== '0' && envValue.toLowerCase() !== 'false') as ClxConfig[K];
    }
    if (key === 'timeout') {
      return parseInt(envValue, 10) as ClxConfig[K];
    }
    return envValue as ClxConfig[K];
  }

  return config[key];
}

// Get API-specific config
export function getApiConfig(apiName: string): { base_url?: string; profile?: string } {
  const config = loadConfig();
  return config.apis?.[apiName] || {};
}

// Check if colors should be used
export function shouldUseColor(): boolean {
  // NO_COLOR takes precedence (https://no-color.org/)
  if (process.env.NO_COLOR || process.env.CLX_NO_COLOR) {
    return false;
  }
  // Check config
  const configColor = getConfigValue('color');
  if (configColor === false) {
    return false;
  }
  // Default to TTY detection
  return process.stdout.isTTY ?? false;
}

// Check if update checks are enabled
export function shouldCheckUpdates(): boolean {
  if (process.env.CLX_NO_UPDATE_CHECK) {
    return false;
  }
  const configValue = getConfigValue('update_check');
  return configValue !== false;
}

// Get registry URL
export function getRegistryUrl(): string {
  return process.env.CLX_REGISTRY || getConfigValue('registry') || 'https://registry.clx.dev';
}

// Get request timeout in ms
export function getRequestTimeout(): number {
  const timeout = getConfigValue('timeout');
  return (timeout || 30) * 1000;
}

// Check for API key in environment variable (e.g., STRIPE_API_KEY)
export function getEnvApiKey(apiName: string): string | undefined {
  const envKey = `${apiName.toUpperCase()}_API_KEY`;
  return process.env[envKey];
}

// Reset config cache (for testing)
export function resetConfigCache(): void {
  configCache = null;
}

export function ensureConfigDirs(): void {
  const configDir = getConfigDir();
  const specsDir = getSpecsDir();
  const authDir = getAuthDir();

  // Create config and specs dirs with default permissions
  for (const dir of [configDir, specsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Create auth dir with restricted permissions (700)
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
  } else {
    // Ensure existing auth dir has correct permissions
    try {
      const stats = fs.statSync(authDir);
      const mode = stats.mode & 0o777;
      if (mode > 0o700) {
        fs.chmodSync(authDir, 0o700);
      }
    } catch {
      // Ignore chmod errors on platforms that don't support it
    }
  }
}

export function loadSpec(apiName: string): OpenAPISpec | null {
  const specsDir = getSpecsDir();

  // Try .yaml first, then .json
  const yamlPath = path.join(specsDir, `${apiName}.yaml`);
  const jsonPath = path.join(specsDir, `${apiName}.json`);

  let specPath: string | null = null;
  if (fs.existsSync(yamlPath)) {
    specPath = yamlPath;
  } else if (fs.existsSync(jsonPath)) {
    specPath = jsonPath;
  }

  if (!specPath) {
    return null;
  }

  const content = fs.readFileSync(specPath, 'utf-8');

  if (specPath.endsWith('.yaml') || specPath.endsWith('.yml')) {
    return YAML.parse(content) as OpenAPISpec;
  } else {
    return JSON.parse(content) as OpenAPISpec;
  }
}

export function saveSpec(apiName: string, spec: OpenAPISpec, format: 'yaml' | 'json' = 'yaml'): void {
  ensureConfigDirs();
  const specsDir = getSpecsDir();
  const ext = format === 'yaml' ? '.yaml' : '.json';
  const specPath = path.join(specsDir, `${apiName}${ext}`);

  const content = format === 'yaml' ? YAML.stringify(spec) : JSON.stringify(spec, null, 2);
  fs.writeFileSync(specPath, content);
}

// Check if auth config is in legacy format (single profile)
function isLegacyAuthConfig(config: unknown): config is LegacyAuthConfig {
  return typeof config === 'object' && config !== null && 'type' in config && !('profiles' in config);
}

// Convert legacy auth config to new multi-profile format
function migrateLegacyAuth(legacy: LegacyAuthConfig): AuthConfig {
  return {
    defaultProfile: 'default',
    profiles: {
      default: legacy as AuthProfile,
    },
  };
}

export function loadAuth(apiName: string, profileName?: string): AuthConfig | null {
  const authPath = path.join(getAuthDir(), `${apiName}.json`);

  if (!fs.existsSync(authPath)) {
    return null;
  }

  const content = fs.readFileSync(authPath, 'utf-8');
  const parsed = JSON.parse(content);

  // Handle legacy format migration
  if (isLegacyAuthConfig(parsed)) {
    const migrated = migrateLegacyAuth(parsed);
    // Save migrated config
    saveAuth(apiName, migrated);
    return migrated;
  }

  return parsed as AuthConfig;
}

// Get a specific auth profile (or default)
export function getAuthProfile(apiName: string, profileName?: string): AuthProfile | null {
  const config = loadAuth(apiName);
  if (!config) return null;

  const name = profileName || config.defaultProfile;
  return config.profiles[name] || null;
}

// List all profile names for an API
export function listAuthProfiles(apiName: string): string[] {
  const config = loadAuth(apiName);
  if (!config) return [];
  return Object.keys(config.profiles);
}

export function saveAuth(apiName: string, auth: AuthConfig): void {
  ensureConfigDirs();
  const authPath = path.join(getAuthDir(), `${apiName}.json`);
  fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

// Save or update a specific profile
export function saveAuthProfile(apiName: string, profile: AuthProfile, profileName: string = 'default'): void {
  let config = loadAuth(apiName);

  if (!config) {
    config = {
      defaultProfile: profileName,
      profiles: {},
    };
  }

  config.profiles[profileName] = profile;
  saveAuth(apiName, config);
}

// Set the default profile
export function setDefaultAuthProfile(apiName: string, profileName: string): boolean {
  const config = loadAuth(apiName);
  if (!config) return false;

  if (!config.profiles[profileName]) {
    return false;
  }

  config.defaultProfile = profileName;
  saveAuth(apiName, config);
  return true;
}

// Remove a specific profile
export function removeAuthProfile(apiName: string, profileName: string): boolean {
  const config = loadAuth(apiName);
  if (!config) return false;

  if (!config.profiles[profileName]) {
    return false;
  }

  delete config.profiles[profileName];

  // If we removed the default profile, set a new default
  if (config.defaultProfile === profileName) {
    const remaining = Object.keys(config.profiles);
    if (remaining.length > 0) {
      config.defaultProfile = remaining[0];
    }
  }

  // If no profiles left, remove the whole file
  if (Object.keys(config.profiles).length === 0) {
    return removeAuth(apiName);
  }

  saveAuth(apiName, config);
  return true;
}

export function removeAuth(apiName: string): boolean {
  const authPath = path.join(getAuthDir(), `${apiName}.json`);
  if (fs.existsSync(authPath)) {
    fs.unlinkSync(authPath);
    return true;
  }
  return false;
}

export function listInstalledSpecs(): string[] {
  const specsDir = getSpecsDir();
  if (!fs.existsSync(specsDir)) {
    return [];
  }

  return fs.readdirSync(specsDir)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.json') || f.endsWith('.yml'))
    .map(f => f.replace(/\.(yaml|yml|json)$/, ''));
}

export function removeSpec(apiName: string): boolean {
  const specsDir = getSpecsDir();
  const yamlPath = path.join(specsDir, `${apiName}.yaml`);
  const jsonPath = path.join(specsDir, `${apiName}.json`);

  let removed = false;
  if (fs.existsSync(yamlPath)) {
    fs.unlinkSync(yamlPath);
    removed = true;
  }
  if (fs.existsSync(jsonPath)) {
    fs.unlinkSync(jsonPath);
    removed = true;
  }
  return removed;
}
