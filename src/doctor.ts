// Diagnostic checks for clx setup

import * as fs from 'fs';
import * as path from 'path';
import { getConfigDir, getSpecsDir, getAuthDir, getBinDir, listInstalledSpecs } from './config.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  hint?: string;
}

// Run all diagnostic checks
export async function runDiagnostics(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Check config directory
  results.push(checkConfigDir());

  // Check specs directory
  results.push(checkSpecsDir());

  // Check auth directory
  results.push(checkAuthDir());

  // Check bin directory
  results.push(checkBinDir());

  // Check installed specs
  const specsCheck = checkInstalledSpecs();
  results.push(...specsCheck);

  // Check network connectivity
  results.push(await checkNetwork());

  // Check symlinks
  results.push(checkSymlinks());

  return results;
}

// Check config directory exists and is writable
function checkConfigDir(): CheckResult {
  const configDir = getConfigDir();

  try {
    if (!fs.existsSync(configDir)) {
      return {
        name: 'Config directory',
        status: 'warn',
        message: `Directory does not exist: ${configDir}`,
        hint: 'Run any clx command to create it automatically',
      };
    }

    // Check if writable
    fs.accessSync(configDir, fs.constants.W_OK);

    return {
      name: 'Config directory',
      status: 'ok',
      message: configDir,
    };
  } catch (error) {
    return {
      name: 'Config directory',
      status: 'error',
      message: `Not writable: ${configDir}`,
      hint: `Check permissions with: chmod 755 ${configDir}`,
    };
  }
}

// Check specs directory
function checkSpecsDir(): CheckResult {
  const specsDir = getSpecsDir();

  try {
    if (!fs.existsSync(specsDir)) {
      return {
        name: 'Specs directory',
        status: 'warn',
        message: `Directory does not exist: ${specsDir}`,
        hint: 'Run "clx install <api>" to install your first API',
      };
    }

    fs.accessSync(specsDir, fs.constants.W_OK);

    return {
      name: 'Specs directory',
      status: 'ok',
      message: specsDir,
    };
  } catch (error) {
    return {
      name: 'Specs directory',
      status: 'error',
      message: `Not writable: ${specsDir}`,
      hint: `Check permissions with: chmod 755 ${specsDir}`,
    };
  }
}

// Check auth directory
function checkAuthDir(): CheckResult {
  const authDir = getAuthDir();

  try {
    if (!fs.existsSync(authDir)) {
      return {
        name: 'Auth directory',
        status: 'warn',
        message: `Directory does not exist: ${authDir}`,
        hint: 'Run "<api> auth login" to configure authentication',
      };
    }

    // Check permissions - should be 700 or 750
    const stats = fs.statSync(authDir);
    const mode = stats.mode & 0o777;

    if (mode > 0o750) {
      return {
        name: 'Auth directory',
        status: 'warn',
        message: `Insecure permissions (${mode.toString(8)}): ${authDir}`,
        hint: `Restrict with: chmod 700 ${authDir}`,
      };
    }

    return {
      name: 'Auth directory',
      status: 'ok',
      message: authDir,
    };
  } catch (error) {
    return {
      name: 'Auth directory',
      status: 'error',
      message: `Cannot access: ${authDir}`,
      hint: 'Check if the directory exists and has correct permissions',
    };
  }
}

// Check bin directory
function checkBinDir(): CheckResult {
  const binDir = getBinDir();

  try {
    if (!fs.existsSync(binDir)) {
      return {
        name: 'Bin directory',
        status: 'warn',
        message: `Directory does not exist: ${binDir}`,
        hint: 'Create it or set CLX_BIN_DIR to a different path',
      };
    }

    // Check if in PATH
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    const inPath = pathDirs.includes(binDir);

    if (!inPath) {
      return {
        name: 'Bin directory',
        status: 'warn',
        message: `${binDir} is not in PATH`,
        hint: `Add to PATH: export PATH="${binDir}:$PATH"`,
      };
    }

    // Check if writable
    try {
      fs.accessSync(binDir, fs.constants.W_OK);
    } catch {
      return {
        name: 'Bin directory',
        status: 'warn',
        message: `Not writable: ${binDir}`,
        hint: `Set CLX_BIN_DIR to a writable directory`,
      };
    }

    return {
      name: 'Bin directory',
      status: 'ok',
      message: `${binDir} (in PATH)`,
    };
  } catch (error) {
    return {
      name: 'Bin directory',
      status: 'error',
      message: `Cannot access: ${binDir}`,
      hint: 'Set CLX_BIN_DIR to a valid directory',
    };
  }
}

// Check installed specs
function checkInstalledSpecs(): CheckResult[] {
  const results: CheckResult[] = [];
  const specs = listInstalledSpecs();

  if (specs.length === 0) {
    results.push({
      name: 'Installed APIs',
      status: 'warn',
      message: 'No APIs installed',
      hint: 'Run "clx install <api>" to install an API',
    });
    return results;
  }

  results.push({
    name: 'Installed APIs',
    status: 'ok',
    message: `${specs.length} API(s): ${specs.join(', ')}`,
  });

  // Check each spec file
  const specsDir = getSpecsDir();
  for (const spec of specs) {
    const yamlPath = path.join(specsDir, `${spec}.yaml`);
    const jsonPath = path.join(specsDir, `${spec}.json`);
    const specPath = fs.existsSync(yamlPath) ? yamlPath : jsonPath;

    try {
      const content = fs.readFileSync(specPath, 'utf-8');
      const size = Buffer.byteLength(content);

      if (size > 10 * 1024 * 1024) { // 10MB
        results.push({
          name: `Spec: ${spec}`,
          status: 'warn',
          message: `Large spec file (${Math.round(size / 1024 / 1024)}MB)`,
          hint: 'Large specs may cause slow startup times',
        });
      }
    } catch (error) {
      results.push({
        name: `Spec: ${spec}`,
        status: 'error',
        message: `Cannot read spec file`,
        hint: `Try reinstalling with: clx install ${spec}`,
      });
    }
  }

  return results;
}

// Check network connectivity
async function checkNetwork(): Promise<CheckResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch('https://api.github.com', {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return {
        name: 'Network',
        status: 'ok',
        message: 'Connected to internet',
      };
    }

    return {
      name: 'Network',
      status: 'warn',
      message: `API returned ${response.status}`,
      hint: 'Some registry operations may not work',
    };
  } catch (error) {
    return {
      name: 'Network',
      status: 'error',
      message: 'Cannot connect to internet',
      hint: 'Check your network connection and firewall settings',
    };
  }
}

// Check symlinks are valid
function checkSymlinks(): CheckResult {
  const binDir = getBinDir();
  const specs = listInstalledSpecs();

  if (specs.length === 0) {
    return {
      name: 'Symlinks',
      status: 'ok',
      message: 'No symlinks to check',
    };
  }

  const broken: string[] = [];

  for (const spec of specs) {
    const symlinkPath = path.join(binDir, spec);

    try {
      if (fs.existsSync(symlinkPath)) {
        const stats = fs.lstatSync(symlinkPath);
        if (stats.isSymbolicLink()) {
          const target = fs.readlinkSync(symlinkPath);
          if (!fs.existsSync(target)) {
            broken.push(spec);
          }
        }
      } else {
        broken.push(spec);
      }
    } catch {
      broken.push(spec);
    }
  }

  if (broken.length > 0) {
    return {
      name: 'Symlinks',
      status: 'warn',
      message: `Missing or broken: ${broken.join(', ')}`,
      hint: `Reinstall with: clx install ${broken[0]}`,
    };
  }

  return {
    name: 'Symlinks',
    status: 'ok',
    message: `${specs.length} symlink(s) valid`,
  };
}

// Print diagnostic results
export function printDiagnostics(results: CheckResult[]): void {
  console.log('clx doctor\n');

  const statusSymbols = {
    ok: '✓',
    warn: '!',
    error: '✗',
  };

  const statusColors = {
    ok: '\x1b[32m',    // green
    warn: '\x1b[33m',  // yellow
    error: '\x1b[31m', // red
  };
  const reset = '\x1b[0m';

  let hasErrors = false;
  let hasWarnings = false;

  for (const result of results) {
    const symbol = statusSymbols[result.status];
    const color = statusColors[result.status];

    console.log(`${color}${symbol}${reset} ${result.name}: ${result.message}`);

    if (result.hint) {
      console.log(`    ${result.hint}`);
    }

    if (result.status === 'error') hasErrors = true;
    if (result.status === 'warn') hasWarnings = true;
  }

  console.log();

  if (hasErrors) {
    console.log('Some checks failed. Please fix the errors above.');
  } else if (hasWarnings) {
    console.log('Setup looks good, but there are some warnings.');
  } else {
    console.log('All checks passed! clx is ready to use.');
  }
}
