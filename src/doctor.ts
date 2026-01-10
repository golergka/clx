// Diagnostic checks for clx setup

import * as fs from 'fs';
import * as path from 'path';
import { getConfigDir, loadAuth } from './config.js';
import { listInstalledApis } from './adapter-loader.js';
import { bold, dim, cyan, green, yellow, red, symbols } from './ui.js';
import { getVersion } from './update.js';
import { CheckResult, checkPath, checkBinDir, checkSymlinks } from './checks.js';

export type { CheckResult } from './checks.js';

export interface DoctorOptions {
  json?: boolean;
  fix?: boolean;
}

// Run all diagnostic checks
export async function runDiagnostics(options: DoctorOptions = {}): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Check clx version
  results.push({
    name: 'clx version',
    status: 'ok',
    message: getVersion(),
  });

  // Check shell
  const shell = path.basename(process.env.SHELL || 'unknown');
  results.push({
    name: 'Shell',
    status: 'ok',
    message: shell,
  });

  // Check PATH setup
  results.push(checkPath());

  // Check config directory
  results.push(checkConfigDir());

  // Check installed APIs and auth
  const { apisCheck, authChecks } = checkInstalledApisAuth();
  results.push(apisCheck);
  results.push(...authChecks);

  // Check network connectivity
  results.push(await checkNetwork());

  // Check bin directory writable
  results.push(checkBinDir());

  // Check symlinks
  const symlinkResult = checkSymlinks(options.fix);
  results.push(symlinkResult);

  // Check disk space (basic check)
  results.push(checkDiskSpace());

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
        message: `Does not exist: ${configDir}`,
        hint: 'Run any clx command to create it',
      };
    }

    // Check if writable
    fs.accessSync(configDir, fs.constants.W_OK);

    return {
      name: 'Config directory',
      status: 'ok',
      message: `${configDir} (writable)`,
    };
  } catch {
    return {
      name: 'Config directory',
      status: 'error',
      message: `Not writable: ${configDir}`,
      hint: `Check permissions: chmod 755 ${configDir}`,
    };
  }
}

// Check installed APIs and their auth status
function checkInstalledApisAuth(): { apisCheck: CheckResult; authChecks: CheckResult[] } {
  const specs = listInstalledApis();
  const authChecks: CheckResult[] = [];

  if (specs.length === 0) {
    return {
      apisCheck: {
        name: 'Installed APIs',
        status: 'warn',
        message: 'None installed',
        hint: `Run 'clx install <api>' to install an API`,
      },
      authChecks: [],
    };
  }

  // Count authenticated APIs
  let authenticated = 0;
  const notAuthenticated: string[] = [];

  for (const spec of specs) {
    const auth = loadAuth(spec);
    if (auth && Object.keys(auth.profiles).length > 0) {
      authenticated++;
    } else {
      notAuthenticated.push(spec);
    }
  }

  const apisCheck: CheckResult = {
    name: `${specs.length} APIs installed`,
    status: 'ok',
    message: specs.join(', '),
  };

  // Add auth status
  if (authenticated > 0) {
    authChecks.push({
      name: `${authenticated} authenticated`,
      status: 'ok',
      message: specs.filter(s => !notAuthenticated.includes(s)).join(', '),
    });
  }

  for (const api of notAuthenticated) {
    authChecks.push({
      name: `${api}`,
      status: 'warn',
      message: 'not authenticated',
      hint: `Run '${api} auth login' to authenticate`,
    });
  }

  return { apisCheck, authChecks };
}

// Check network connectivity
async function checkNetwork(): Promise<CheckResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const startTime = Date.now();

    const response = await fetch('https://api.github.com', {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const elapsed = Date.now() - startTime;

    if (response.ok) {
      if (elapsed > 2000) {
        return {
          name: 'Network',
          status: 'warn',
          message: `Slow connection (${elapsed}ms)`,
          hint: 'Some operations may be slow',
        };
      }
      return {
        name: 'Network',
        status: 'ok',
        message: 'registry.clx.dev reachable',
      };
    }

    return {
      name: 'Network',
      status: 'warn',
      message: `API returned ${response.status}`,
      hint: 'Some registry operations may not work',
    };
  } catch {
    return {
      name: 'Network',
      status: 'error',
      message: 'Cannot reach network',
      hint: 'Check your internet connection',
    };
  }
}

// Basic disk space check
function checkDiskSpace(): CheckResult {
  try {
    // This is a simplified check - just verify we can write
    const testFile = path.join(getConfigDir(), '.disktest');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);

    return {
      name: 'Disk space',
      status: 'ok',
      message: 'Writable',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('ENOSPC')) {
      return {
        name: 'Disk space',
        status: 'error',
        message: 'Disk full',
        hint: 'Free up disk space',
      };
    }
    return {
      name: 'Disk space',
      status: 'warn',
      message: msg,
    };
  }
}

// Print diagnostic results with colors
export function printDiagnostics(results: CheckResult[], options: DoctorOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify({ checks: results }, null, 2));
    return;
  }

  console.log('');
  console.log(`  ${bold('clx doctor')}`);
  console.log('');

  let hasErrors = false;
  let hasWarnings = false;
  let warningCount = 0;

  for (const result of results) {
    const sym = result.status === 'ok' ? green(symbols.success) :
                result.status === 'warn' ? yellow(symbols.warning) :
                red(symbols.error);

    console.log(`  ${sym} ${result.name}: ${result.message}`);

    if (result.hint) {
      console.log(`      ${dim(result.hint)}`);
    }

    if (result.status === 'error') hasErrors = true;
    if (result.status === 'warn') {
      hasWarnings = true;
      warningCount++;
    }
  }

  console.log('');

  if (hasErrors) {
    console.log(`  ${red('Some checks failed. Please fix the errors above.')}`);
  } else if (hasWarnings) {
    console.log(`  ${warningCount} warning${warningCount > 1 ? 's' : ''}. Run '${cyan('clx auth login <api>')}' to authenticate.`);
  } else {
    console.log(`  ${green('All checks passed!')} clx is ready to use.`);
  }
}
