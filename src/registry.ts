import * as fs from 'fs';
import * as path from 'path';
import type { OpenAPISpec } from './types.js';
import { getSpecsDir, getBinDir, ensureConfigDirs, listInstalledSpecs, removeSpec, loadSpec, removeAuth } from './config.js';
import { validateApiName, sanitizeFilename } from './errors.js';
import { success, warning, error, dim, cyan, bold, spinner, confirm, isTTY } from './ui.js';
import { printPathWarning } from './setup.js';

// Known API specs registry
interface RegistryEntry {
  url: string;
  description: string;
  baseUrl?: string;
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

export function getRegistryEntry(apiName: string): RegistryEntry | null {
  return REGISTRY[apiName.toLowerCase()] || null;
}

function getClxBinaryPath(): string {
  const argv0 = process.argv[0];

  if (argv0.includes('bun') || argv0.includes('node')) {
    const binDir = getBinDir();
    const clxPath = path.join(binDir, 'clx');
    if (fs.existsSync(clxPath)) {
      return clxPath;
    }
    return process.argv[1];
  }

  return argv0;
}

function createSymlink(apiName: string): void {
  const binDir = getBinDir();
  const clxPath = getClxBinaryPath();
  const symlinkPath = path.join(binDir, apiName);

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  if (fs.existsSync(symlinkPath)) {
    const stats = fs.lstatSync(symlinkPath);
    if (stats.isSymbolicLink()) {
      fs.unlinkSync(symlinkPath);
    } else {
      console.log(error(`${symlinkPath} exists and is not a symlink`));
      console.log(`    Please remove it manually to install ${apiName}.`);
      process.exit(1);
    }
  }

  try {
    fs.symlinkSync(clxPath, symlinkPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      console.log(error(`Permission denied creating symlink`));
      console.log(`    Set CLX_BIN_DIR to a writable directory.`);
    } else {
      throw err;
    }
  }
}

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

export interface ListOptions {
  json?: boolean;
}

export function searchRegistry(query: string, options: { json?: boolean } = {}): void {
  const results = Object.entries(REGISTRY)
    .filter(([name, info]) =>
      !query ||
      name.includes(query.toLowerCase()) ||
      info.description.toLowerCase().includes(query.toLowerCase())
    );

  if (options.json) {
    const apis = results.map(([name, info]) => ({
      name,
      description: info.description,
      url: info.url,
    }));
    console.log(JSON.stringify({ apis }, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log(warning(`No APIs found matching '${query}'`));
    return;
  }

  console.log('');
  console.log(`  ${bold('Available APIs:')}`);
  console.log('');

  for (const [name, info] of results) {
    console.log(`  ${cyan(name.padEnd(15))} ${info.description}`);
  }

  console.log('');
  console.log(`  Run '${cyan('clx install <api>')}' to install.`);
}

export interface InstallOptions {
  name?: string;
  quiet?: boolean;
  json?: boolean;
}

export async function installApi(nameOrUrl: string, options: InstallOptions = {}): Promise<void> {
  ensureConfigDirs();

  let url: string;
  let apiName: string;
  const customName = options.name;

  // Check if it's a URL
  if (nameOrUrl.startsWith('http://') || nameOrUrl.startsWith('https://')) {
    url = nameOrUrl;
    apiName = sanitizeFilename(customName || path.basename(nameOrUrl, path.extname(nameOrUrl)));
    validateApiName(apiName);
  } else if (nameOrUrl.endsWith('.yaml') || nameOrUrl.endsWith('.json') || nameOrUrl.endsWith('.yml')) {
    // Local file
    if (!fs.existsSync(nameOrUrl)) {
      console.log(error(`File not found: ${nameOrUrl}`));
      process.exit(1);
    }

    apiName = sanitizeFilename(customName || path.basename(nameOrUrl, path.extname(nameOrUrl)));
    validateApiName(apiName);

    const ext = path.extname(nameOrUrl);
    const destPath = path.join(getSpecsDir(), `${apiName}${ext}`);
    fs.copyFileSync(nameOrUrl, destPath);

    createSymlink(apiName);

    if (options.json) {
      console.log(JSON.stringify({ installed: apiName, source: 'local', path: destPath }));
    } else if (!options.quiet) {
      console.log(success(`Installed ${apiName} from local file`));
      printPathWarning();
    }
    return;
  } else {
    // Look up in registry
    const registryEntry = REGISTRY[nameOrUrl.toLowerCase()];
    if (!registryEntry) {
      console.log(error(`API '${nameOrUrl}' not found in registry`));
      console.log('');
      console.log(`    Did you mean one of these?`);
      const similar = Object.keys(REGISTRY).filter(k =>
        k.includes(nameOrUrl.toLowerCase()) || nameOrUrl.toLowerCase().includes(k)
      );
      if (similar.length > 0) {
        for (const s of similar.slice(0, 3)) {
          console.log(`      ${cyan(s)}`);
        }
      }
      console.log('');
      console.log(`    Run '${cyan('clx search')}' to see all available APIs.`);
      process.exit(1);
    }

    url = registryEntry.url;
    apiName = customName || nameOrUrl.toLowerCase();
  }

  const s = !options.quiet && isTTY ? spinner(`Installing ${apiName}`) : null;

  try {
    s?.update(`Fetching spec`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    s?.update(`Parsing spec`);
    const content = await response.text();
    const isYaml = url.endsWith('.yaml') || url.endsWith('.yml') || content.trim().startsWith('openapi:');
    const ext = isYaml ? '.yaml' : '.json';

    const destPath = path.join(getSpecsDir(), `${apiName}${ext}`);
    fs.writeFileSync(destPath, content);

    s?.update(`Creating symlink`);
    createSymlink(apiName);

    // Get spec info for output
    const spec = loadSpec(apiName);
    const version = spec?.info?.version || 'unknown';
    const endpoints = spec?.paths ? Object.keys(spec.paths).length : 0;

    s?.stop(`Installed ${apiName}`, 'success');

    if (options.json) {
      console.log(JSON.stringify({
        installed: apiName,
        source: 'registry',
        version,
        endpoints,
      }));
    } else if (!options.quiet) {
      console.log(dim(`    └─ v${version} • ${endpoints} endpoints`));
      printPathWarning();
      console.log('');
      console.log(`  Run '${cyan(`${apiName} --help`)}' to get started.`);
    }
  } catch (err) {
    s?.stop(`Failed to install ${apiName}`, 'error');

    if (!options.quiet) {
      console.log('');
      console.log(`    ${err instanceof Error ? err.message : String(err)}`);
      console.log('');
      console.log(`    Check your internet connection and try again.`);
    }
    process.exit(1);
  }
}

export function listApis(options: ListOptions = {}): void {
  const installed = listInstalledSpecs();

  if (options.json) {
    const apis = installed.map(name => {
      const spec = loadSpec(name);
      return {
        name,
        title: spec?.info?.title || name,
        version: spec?.info?.version || 'unknown',
      };
    });
    console.log(JSON.stringify({ apis }, null, 2));
    return;
  }

  if (installed.length === 0) {
    console.log(warning('No APIs installed'));
    console.log(`    Run '${cyan('clx install <api>')}' to install an API.`);
    return;
  }

  console.log('');
  console.log(`  ${bold('Installed APIs:')}`);
  console.log('');

  for (const name of installed) {
    const spec = loadSpec(name);
    const title = spec?.info?.title || name;
    const version = spec?.info?.version || 'unknown';
    console.log(`  ${cyan(name.padEnd(15))} ${title} ${dim(`(v${version})`)}`);
  }
}

export interface UpdateOptions {
  quiet?: boolean;
  json?: boolean;
}

export async function updateApi(apiName: string, options: UpdateOptions = {}): Promise<void> {
  const spec = loadSpec(apiName);
  if (!spec) {
    console.log(error(`API '${apiName}' is not installed`));
    process.exit(1);
  }

  const registryEntry = REGISTRY[apiName.toLowerCase()];
  if (!registryEntry) {
    console.log(error(`API '${apiName}' is not in the registry`));
    console.log(`    Re-install manually with: ${cyan(`clx install <url> --name ${apiName}`)}`);
    process.exit(1);
  }

  const oldVersion = spec.info?.version || 'unknown';

  await installApi(registryEntry.url, { name: apiName, quiet: options.quiet, json: options.json });

  const newSpec = loadSpec(apiName);
  const newVersion = newSpec?.info?.version || 'unknown';

  if (!options.quiet && !options.json && oldVersion !== newVersion) {
    console.log(dim(`    Updated from v${oldVersion} to v${newVersion}`));
  }
}

export interface RemoveOptions {
  yes?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export async function removeApi(apiName: string, options: RemoveOptions = {}): Promise<void> {
  const spec = loadSpec(apiName);
  if (!spec) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'not_installed', api: apiName }));
    } else {
      console.log(error(`API '${apiName}' is not installed`));
    }
    process.exit(1);
  }

  // Confirmation prompt unless --yes
  if (!options.yes && !options.quiet && isTTY) {
    console.log('');
    console.log(`  This will remove:`);
    console.log(`    • ${apiName} API and symlink`);
    console.log(`    • Saved authentication`);
    console.log('');

    const confirmed = await confirm('Are you sure?', false);
    if (!confirmed) {
      console.log('');
      console.log(dim('  Cancelled.'));
      return;
    }
  }

  const specRemoved = removeSpec(apiName);
  const symlinkRemoved = removeSymlink(apiName);
  const authRemoved = removeAuth(apiName);

  if (options.json) {
    console.log(JSON.stringify({
      removed: apiName,
      specRemoved,
      symlinkRemoved,
      authRemoved,
    }));
  } else if (!options.quiet) {
    console.log(success(`Uninstalled ${apiName}`));
  }
}

export function addLocalSpec(filePath: string, name: string): void {
  const sanitizedName = sanitizeFilename(name);
  validateApiName(sanitizedName);

  if (!fs.existsSync(filePath)) {
    console.log(error(`File not found: ${filePath}`));
    process.exit(1);
  }

  ensureConfigDirs();

  const ext = path.extname(filePath);
  const destPath = path.join(getSpecsDir(), `${sanitizedName}${ext}`);

  fs.copyFileSync(filePath, destPath);
  createSymlink(sanitizedName);

  console.log(success(`Added ${sanitizedName}`));
  console.log(dim(`    └─ ${destPath}`));
  printPathWarning();
}
