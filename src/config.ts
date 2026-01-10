import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import YAML from 'yaml';
import type { OpenAPISpec, AuthConfig, AuthProfile, LegacyAuthConfig } from './types.js';

// XDG standard: ~/.config/clx/
export function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return path.join(xdgConfig, 'clx');
  }
  return path.join(os.homedir(), '.config', 'clx');
}

export function getSpecsDir(): string {
  return path.join(getConfigDir(), 'specs');
}

export function getAuthDir(): string {
  return path.join(getConfigDir(), 'auth');
}

export function getBinDir(): string {
  // Default to /usr/local/bin, but allow override
  return process.env.CLX_BIN_DIR || '/usr/local/bin';
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
