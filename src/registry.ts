import * as fs from 'fs';
import * as path from 'path';
import type { OpenAPISpec } from './types.js';
import { getSpecsDir, getBinDir, ensureConfigDirs, listInstalledSpecs, removeSpec, loadSpec } from './config.js';
import { validateApiName, sanitizeFilename } from './errors.js';

// Known API specs registry
// In a real implementation, this would be fetched from a remote registry
interface RegistryEntry {
  url: string;
  description: string;
  baseUrl?: string; // Override for specs with relative server URLs
}

const REGISTRY: Record<string, RegistryEntry> = {
  'stripe': {
    url: 'https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json',
    description: 'Stripe Payment API',
  },
  'github': {
    url: 'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json',
    description: 'GitHub REST API',
  },
  'openai': {
    url: 'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/manual_spec/openapi.yaml',
    description: 'OpenAI API',
  },
  'petstore': {
    url: 'https://petstore3.swagger.io/api/v3/openapi.json',
    description: 'Swagger Petstore (demo API)',
    baseUrl: 'https://petstore3.swagger.io',
  },
  'slack': {
    url: 'https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json',
    description: 'Slack Web API',
  },
  'twilio': {
    url: 'https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json',
    description: 'Twilio REST API',
  },
  'discord': {
    url: 'https://raw.githubusercontent.com/discord/discord-api-spec/main/specs/openapi.json',
    description: 'Discord API',
  },
  'anthropic': {
    url: 'https://raw.githubusercontent.com/laszukdawid/anthropic-openapi-spec/main/hosted_spec_v3.0.0.json',
    description: 'Anthropic Claude API (unofficial)',
  },
};

// Get registry entry for an API
export function getRegistryEntry(apiName: string): RegistryEntry | null {
  return REGISTRY[apiName.toLowerCase()] || null;
}

// Get the path to the clx binary
function getClxBinaryPath(): string {
  // When running compiled, argv[0] is the binary path
  // When running via bun/node, we need to find the actual binary
  const argv0 = process.argv[0];

  if (argv0.includes('bun') || argv0.includes('node')) {
    // Running via runtime, check if clx is in PATH
    const binDir = getBinDir();
    const clxPath = path.join(binDir, 'clx');
    if (fs.existsSync(clxPath)) {
      return clxPath;
    }
    // Return the script path for development
    return process.argv[1];
  }

  return argv0;
}

// Create symlink for an API
function createSymlink(apiName: string): void {
  const binDir = getBinDir();
  const clxPath = getClxBinaryPath();
  const symlinkPath = path.join(binDir, apiName);

  // Check if symlink already exists
  if (fs.existsSync(symlinkPath)) {
    const stats = fs.lstatSync(symlinkPath);
    if (stats.isSymbolicLink()) {
      // Remove existing symlink
      fs.unlinkSync(symlinkPath);
    } else {
      console.error(`Error: ${symlinkPath} exists and is not a symlink.`);
      console.error(`Please remove it manually if you want to install ${apiName}.`);
      process.exit(1);
    }
  }

  try {
    fs.symlinkSync(clxPath, symlinkPath);
    console.log(`Created symlink: ${symlinkPath} -> ${clxPath}`);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EACCES') {
      console.error(`Permission denied. Try running with sudo or change CLX_BIN_DIR.`);
      console.error(`  export CLX_BIN_DIR=~/.local/bin`);
    } else {
      throw error;
    }
  }
}

// Remove symlink for an API
function removeSymlink(apiName: string): boolean {
  const binDir = getBinDir();
  const symlinkPath = path.join(binDir, apiName);

  if (fs.existsSync(symlinkPath)) {
    const stats = fs.lstatSync(symlinkPath);
    if (stats.isSymbolicLink()) {
      fs.unlinkSync(symlinkPath);
      return true;
    }
  }
  return false;
}

// Search registry
export function searchRegistry(query: string): void {
  const results = Object.entries(REGISTRY)
    .filter(([name, info]) =>
      name.includes(query.toLowerCase()) ||
      info.description.toLowerCase().includes(query.toLowerCase())
    );

  if (results.length === 0) {
    console.log(`No APIs found matching '${query}'.`);
    return;
  }

  console.log('Available APIs:');
  console.log();

  for (const [name, info] of results) {
    console.log(`  ${name.padEnd(15)} ${info.description}`);
  }
}

// Install an API from registry or URL
export async function installApi(nameOrUrl: string, customName?: string): Promise<void> {
  ensureConfigDirs();

  let url: string;
  let apiName: string;

  // Check if it's a URL
  if (nameOrUrl.startsWith('http://') || nameOrUrl.startsWith('https://')) {
    url = nameOrUrl;
    apiName = sanitizeFilename(customName || path.basename(nameOrUrl, path.extname(nameOrUrl)));
    validateApiName(apiName);
  } else if (nameOrUrl.endsWith('.yaml') || nameOrUrl.endsWith('.json') || nameOrUrl.endsWith('.yml')) {
    // Local file
    if (!fs.existsSync(nameOrUrl)) {
      console.error(`File not found: ${nameOrUrl}`);
      process.exit(1);
    }

    apiName = sanitizeFilename(customName || path.basename(nameOrUrl, path.extname(nameOrUrl)));
    validateApiName(apiName);
    const content = fs.readFileSync(nameOrUrl, 'utf-8');

    // Copy to specs directory
    const ext = path.extname(nameOrUrl);
    const destPath = path.join(getSpecsDir(), `${apiName}${ext}`);
    fs.copyFileSync(nameOrUrl, destPath);

    console.log(`Installed ${apiName} from local file.`);
    createSymlink(apiName);
    return;
  } else {
    // Look up in registry
    const registryEntry = REGISTRY[nameOrUrl.toLowerCase()];
    if (!registryEntry) {
      console.error(`API '${nameOrUrl}' not found in registry.`);
      console.error(`Use 'clx search <query>' to find available APIs.`);
      console.error(`Or provide a URL or local file path.`);
      process.exit(1);
    }

    url = registryEntry.url;
    apiName = customName || nameOrUrl.toLowerCase();
  }

  console.log(`Downloading ${apiName}...`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();

    // Determine format from URL or content
    const isYaml = url.endsWith('.yaml') || url.endsWith('.yml') || content.trim().startsWith('openapi:');
    const ext = isYaml ? '.yaml' : '.json';

    const destPath = path.join(getSpecsDir(), `${apiName}${ext}`);
    fs.writeFileSync(destPath, content);

    console.log(`Saved spec to ${destPath}`);
    createSymlink(apiName);

    console.log();
    console.log(`Successfully installed ${apiName}.`);
    console.log(`Run '${apiName} --help' to get started.`);
  } catch (error) {
    console.error(`Failed to download spec: ${error}`);
    process.exit(1);
  }
}

// List installed APIs
export function listApis(): void {
  const installed = listInstalledSpecs();

  if (installed.length === 0) {
    console.log('No APIs installed.');
    console.log(`Run 'clx install <api>' to install an API.`);
    return;
  }

  console.log('Installed APIs:');
  console.log();

  for (const name of installed) {
    const spec = loadSpec(name);
    const title = spec?.info?.title || name;
    const version = spec?.info?.version || 'unknown';
    console.log(`  ${name.padEnd(15)} ${title} (v${version})`);
  }
}

// Update an API
export async function updateApi(apiName: string): Promise<void> {
  const spec = loadSpec(apiName);
  if (!spec) {
    console.error(`API '${apiName}' is not installed.`);
    process.exit(1);
  }

  // Check registry for update
  const registryEntry = REGISTRY[apiName.toLowerCase()];
  if (!registryEntry) {
    console.error(`API '${apiName}' is not in the registry. Cannot auto-update.`);
    console.error(`Re-install manually with: clx install <url> --name ${apiName}`);
    process.exit(1);
  }

  console.log(`Updating ${apiName}...`);
  await installApi(registryEntry.url, apiName);
}

// Remove an API
export function removeApi(apiName: string): void {
  const specRemoved = removeSpec(apiName);
  const symlinkRemoved = removeSymlink(apiName);

  if (!specRemoved && !symlinkRemoved) {
    console.error(`API '${apiName}' is not installed.`);
    process.exit(1);
  }

  console.log(`Removed ${apiName}.`);
}

// Add a local spec file
export function addLocalSpec(filePath: string, name: string): void {
  // Validate and sanitize the name
  const sanitizedName = sanitizeFilename(name);
  validateApiName(sanitizedName);

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  ensureConfigDirs();

  const ext = path.extname(filePath);
  const destPath = path.join(getSpecsDir(), `${sanitizedName}${ext}`);

  fs.copyFileSync(filePath, destPath);
  console.log(`Added spec to ${destPath}`);

  createSymlink(sanitizedName);
  console.log(`Created command '${sanitizedName}'.`);
}
