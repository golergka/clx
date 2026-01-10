#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import type { OpenAPISpec, CommandNode, ExecutionContext } from './types.js';
import { loadSpec, getAuthProfile, ensureConfigDirs, listInstalledSpecs, getConfigDir } from './config.js';
import { buildCommandTree, getBaseUrl } from './parser.js';
import { generateRootHelp, generateResourceHelp, generateOperationHelp } from './help.js';
import { parseArgs, buildRequest, executeRequest, generateCurl } from './executor.js';
import { authLogin, authStatus, authLogout, authList, authSwitch, ensureValidToken } from './auth.js';
import { getRegistryEntry, type UpdateOptions } from './registry.js';
import { formatOutput } from './output.js';
import { runDiagnostics, printDiagnostics, type DoctorOptions } from './doctor.js';
import { handleCompletions } from './completions.js';
import { runSetup, isInPath, type SetupOptions } from './setup.js';
import { formatError, formatErrorJson, ExitCode, ClxError, UsageError, suggestCommand } from './errors.js';
import { success, warning, error, info, bold, dim, cyan, confirm, isTTY, box } from './ui.js';
import { checkForUpdates, getVersion } from './update.js';
import { loadAdapter, hasBundledAdapter, getAdapterBaseUrl, listAvailableApis, listInstalledApis, downloadSpec, isSpecInstalled, removeSpec as removeSpecFile, getUserBinDir } from './adapter-loader.js';
import { ensureBinDir, isPathConfigured, createApiSymlink, removeApiSymlink } from './checks.js';
import type { ResolvedAdapter } from './core/index.js';

const VERSION = getVersion();

// Get API name from argv[0] (busybox pattern)
function getApiName(): string {
  const argv0 = process.argv[1];
  const basename = path.basename(argv0);

  // Development mode: running via ts-node or node dist/index.js
  if (basename.endsWith('.ts') || basename === 'index.js') {
    return 'clx';
  }

  return basename;
}

// Read stdin if available (non-blocking check)
async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    return undefined;
  }

  return new Promise((resolve) => {
    let data = '';
    const timeout = setTimeout(() => {
      resolve(undefined);
    }, 100);

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      clearTimeout(timeout);
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      resolve(data.trim() || undefined);
    });
    process.stdin.on('error', () => {
      clearTimeout(timeout);
      resolve(undefined);
    });

    process.stdin.resume();
  });
}

// Check if this is the first run
function isFirstRun(): boolean {
  const configDir = getConfigDir();
  return !fs.existsSync(configDir) && !process.env.CLX_SKIP_SETUP;
}

// First-run experience
async function handleFirstRun(apiName?: string): Promise<boolean> {
  if (!isTTY) {
    return false;
  }

  console.log('');
  console.log(`  ${bold('Welcome to clx!')}`);
  console.log('');
  console.log(`  Looks like this is your first time. Let's get set up.`);
  console.log('');

  // Ask about PATH setup
  const binDir = path.join(require('os').homedir(), '.local', 'bin');
  if (!isInPath(binDir)) {
    const shouldSetup = await confirm('Add clx to your PATH?', true);
    if (shouldSetup) {
      await runSetup({ yes: true });
    }
  }

  // If they tried to use an API, offer to install it
  if (apiName && apiName !== 'clx') {
    console.log('');
    const shouldInstall = await confirm(`Install '${apiName}' API?`, true);
    if (shouldInstall) {
      await installApi(apiName);
      console.log('');
      console.log(`  Now authenticate:`);
      console.log(`    ${cyan(`clx auth login ${apiName}`)}`);
      console.log('');
      console.log(`  Then try again:`);
      console.log(`    ${cyan(`${apiName} --help`)}`);
      return true;
    }
  }

  ensureConfigDirs();
  return false;
}

// Global options
interface GlobalOptions {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  yes?: boolean;
}

function parseGlobalOptions(args: string[]): { options: GlobalOptions; remaining: string[] } {
  const options: GlobalOptions = {};
  const remaining: string[] = [];

  for (const arg of args) {
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--quiet' || arg === '-q') {
      options.quiet = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--yes' || arg === '-y') {
      options.yes = true;
    } else {
      remaining.push(arg);
    }
  }

  return { options, remaining };
}

// Handle clx package manager commands
async function handleClxCommands(args: string[], globalOpts: GlobalOptions): Promise<boolean> {
  if (args.length === 0) {
    printClxHelp();
    return true;
  }

  const command = args[0];
  const rest = args.slice(1);

  switch (command) {
    case '--help':
    case '-h':
    case 'help':
      printClxHelp();
      return true;

    case '--version':
    case '-v':
    case 'version':
      if (globalOpts.json) {
        console.log(JSON.stringify({ version: VERSION }));
      } else {
        console.log(`clx version ${VERSION}`);
      }
      return true;

    case 'install': {
      if (rest.length === 0) {
        console.log(error('Missing API name'));
        console.log(`    Usage: clx install <api>`);
        console.log('');
        console.log(`    Available APIs: ${listAvailableApis().join(', ')}`);
        process.exit(ExitCode.USAGE_ERROR);
      }
      const apiName = rest[0];

      // Check if API has a bundled adapter
      if (!hasBundledAdapter(apiName)) {
        if (globalOpts.json) {
          console.log(JSON.stringify({ error: { type: 'not_found', message: `Unknown API: ${apiName}` } }));
        } else {
          console.log(error(`Unknown API: ${apiName}`));
          console.log('');
          console.log(`    Available APIs: ${listAvailableApis().join(', ')}`);
        }
        process.exit(ExitCode.NOT_FOUND);
      }

      // Check if already installed
      if (isSpecInstalled(apiName)) {
        if (globalOpts.json) {
          console.log(JSON.stringify({ status: 'already_installed', api: apiName }));
        } else {
          console.log(info(`${apiName} is already installed`));
        }
        return true;
      }

      // Download spec from clx repo
      if (!globalOpts.quiet) {
        console.log(`Installing ${apiName}...`);
      }

      const ok = await downloadSpec(apiName);
      if (!ok) {
        if (globalOpts.json) {
          console.log(JSON.stringify({ error: { type: 'download_failed', message: `Failed to download spec for ${apiName}` } }));
        } else {
          console.log(error(`Failed to download spec for ${apiName}`));
        }
        process.exit(ExitCode.NETWORK_ERROR);
      }

      // Ensure bin directory exists and is writable
      if (!ensureBinDir()) {
        if (!globalOpts.quiet) {
          console.log(warning(`Bin directory not writable`));
          console.log(dim(`  Run 'clx doctor' to diagnose`));
        }
      }

      // Create symlink
      const symlinkCreated = createApiSymlink(apiName);
      if (!symlinkCreated && !globalOpts.quiet) {
        console.log(warning(`Could not create symlink`));
        console.log(dim(`  Run 'clx doctor --fix' to diagnose`));
      }

      if (globalOpts.json) {
        console.log(JSON.stringify({ status: 'installed', api: apiName, symlink: symlinkCreated }));
      } else {
        console.log(success(`Installed ${apiName}`));

        // Check if bin dir is in PATH
        if (!isPathConfigured()) {
          console.log('');
          console.log(warning(`~/.clx/bin is not in your PATH`));
          console.log('');
          console.log(`  Run 'clx setup' to fix this, or add manually:`);
          console.log(dim(`    export PATH="$HOME/.clx/bin:$PATH"`));
        }
      }
      return true;
    }

    case 'remove':
    case 'uninstall': {
      if (rest.length === 0) {
        console.log(error('Missing API name'));
        console.log(`    Usage: clx remove <api>`);
        process.exit(ExitCode.USAGE_ERROR);
      }
      const apiName = rest[0];

      if (!isSpecInstalled(apiName)) {
        if (globalOpts.json) {
          console.log(JSON.stringify({ error: { type: 'not_found', message: `${apiName} is not installed` } }));
        } else {
          console.log(error(`${apiName} is not installed`));
        }
        process.exit(ExitCode.NOT_FOUND);
      }

      // Confirm removal
      if (!globalOpts.yes && isTTY()) {
        const confirmed = await confirm(`Remove ${apiName}?`);
        if (!confirmed) {
          console.log('Cancelled.');
          return true;
        }
      }

      // Remove spec
      removeSpecFile(apiName);

      // Remove symlink
      removeApiSymlink(apiName);

      if (globalOpts.json) {
        console.log(JSON.stringify({ status: 'removed', api: apiName }));
      } else {
        console.log(success(`Removed ${apiName}`));
      }
      return true;
    }

    case 'list':
    case 'ls': {
      const { flags } = parseArgs(rest);
      const showAll = flags.has('all') || flags.has('a');
      const installed = listInstalledApis();
      const available = listAvailableApis();

      if (globalOpts.json) {
        if (showAll) {
          console.log(JSON.stringify({ installed, available }));
        } else {
          console.log(JSON.stringify({ installed, availableCount: available.length }));
        }
      } else {
        if (installed.length === 0) {
          console.log(dim('  No APIs installed.'));
        } else {
          console.log('  Installed APIs:');
          console.log('');
          for (const name of installed) {
            const adapter = loadAdapter(name);
            const summary = adapter?.help?.summary || '';
            console.log(`  ${bold(name.padEnd(16))}${summary}`);
          }
        }
        console.log('');
        const notInstalledCount = available.length - installed.length;
        if (showAll) {
          const notInstalled = available.filter(a => !installed.includes(a));
          console.log(`  Available (${notInstalled.length}):`);
          console.log(`  ${notInstalled.join(', ')}`);
        } else {
          console.log(`  ${notInstalledCount} more APIs available. Run 'clx list --all' to see all.`);
        }
      }
      return true;
    }

    case 'update': {
      const { flags, positional } = parseArgs(rest);
      const updateOpts: UpdateOptions = {
        quiet: globalOpts.quiet,
        json: globalOpts.json,
      };

      if (flags.has('all')) {
        const installed = listInstalledSpecs();
        if (installed.length === 0) {
          if (globalOpts.json) {
            console.log(JSON.stringify({ updated: [] }));
          } else {
            console.log(warning('No APIs installed'));
          }
          return true;
        }

        if (!globalOpts.quiet && !globalOpts.json) {
          console.log(`Updating ${installed.length} API(s)...`);
        }

        const results: { api: string; success: boolean; error?: string }[] = [];
        for (const api of installed) {
          try {
            await updateApi(api, updateOpts);
            results.push({ api, success: true });
          } catch (err) {
            results.push({ api, success: false, error: err instanceof Error ? err.message : String(err) });
          }
        }

        if (globalOpts.json) {
          console.log(JSON.stringify({ updated: results }));
        }
        return true;
      }

      if (positional.length === 0) {
        console.log(error('Missing API name'));
        console.log(`    Usage: clx update <api> or clx update --all`);
        process.exit(ExitCode.USAGE_ERROR);
      }
      await updateApi(positional[0], updateOpts);
      return true;
    }

    case 'doctor': {
      const { flags } = parseArgs(rest);
      const doctorOpts: DoctorOptions = {
        json: globalOpts.json,
        fix: flags.has('fix'),
      };
      const results = await runDiagnostics(doctorOpts);
      printDiagnostics(results, doctorOpts);
      return true;
    }

    case 'setup': {
      const { flags } = parseArgs(rest);
      const setupOpts: SetupOptions = {
        shell: flags.get('shell'),
        yes: globalOpts.yes || flags.has('yes'),
        check: flags.has('check'),
        uninstall: flags.has('uninstall'),
        json: globalOpts.json,
      };
      await runSetup(setupOpts);
      return true;
    }

    case 'completion':
    case 'completions': {
      handleCompletions(rest);
      return true;
    }

    default:
      return false;
  }
}

function printClxHelp(): void {
  const available = listAvailableApis();
  console.log(`${bold('clx')} - CLI API Client Generator

${bold('Usage:')}
  clx <command> [options]

${bold('Package Management:')}
  install <api>       Install API
  remove <api>        Remove installed API
  list                List installed/available APIs

${bold('Configuration:')}
  setup               Configure shell integration
  doctor              Run diagnostic checks
  completions <shell> Generate shell completions

${bold('Options:')}
  --json              JSON output
  --quiet, -q         Suppress output
  --yes, -y           Skip confirmations
  --help              Show help
  --version           Show version

${bold('Examples:')}
  clx install stripe
  stripe customers list
  stripe customers get cus_123

Run 'clx list' to see ${available.length} available APIs.

${bold('Documentation:')}
  https://github.com/clx-dev/clx
`);
}

// Navigate the command tree based on arguments
function navigateTree(
  tree: CommandNode,
  args: string[]
): { node: CommandNode; path: string[]; remaining: string[] } {
  let current = tree;
  const path: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith('-')) {
      break;
    }

    if (current.children.has(arg)) {
      current = current.children.get(arg)!;
      path.push(arg);
      i++;
      continue;
    }

    if (current.operations.has(arg)) {
      path.push(arg);
      i++;
      break;
    }

    break;
  }

  return { node: current, path, remaining: args.slice(i) };
}

// Handle auth subcommands
async function handleAuthCommand(apiName: string, spec: OpenAPISpec, args: string[]): Promise<void> {
  const { flags, positional } = parseArgs(args);
  const subcommand = positional[0];
  const profileName = flags.get('profile');

  switch (subcommand) {
    case 'login':
      await authLogin(apiName, spec, profileName || 'default');
      break;
    case 'status':
      authStatus(apiName, profileName);
      break;
    case 'logout':
      authLogout(apiName, profileName);
      break;
    case 'list':
    case 'profiles':
      authList(apiName);
      break;
    case 'switch':
    case 'use':
      if (positional.length < 2) {
        console.log(error('Missing profile name'));
        console.log(`    Usage: ${apiName} auth switch <profile>`);
        process.exit(ExitCode.USAGE_ERROR);
      }
      authSwitch(apiName, positional[1]);
      break;
    default:
      console.log(`${bold(`${apiName} auth`)} - Manage authentication

${bold('Commands:')}
  login [--profile <name>]    Configure authentication
  status [--profile <name>]   Show auth status
  logout [--profile <name>]   Clear credentials
  list                        List all profiles
  switch <name>               Set default profile

${bold('Examples:')}
  ${apiName} auth login
  ${apiName} auth login --profile prod
  ${apiName} auth list
  ${apiName} auth switch prod
`);
  }
}

// Main execution
async function main(): Promise<void> {
  const apiName = getApiName();
  const allArgs = process.argv.slice(2);

  // Parse global options
  const { options: globalOpts, remaining: args } = parseGlobalOptions(allArgs);

  // First-run experience
  if (isFirstRun() && apiName === 'clx') {
    const handled = await handleFirstRun();
    if (handled) return;
  }

  // If running as 'clx', handle package manager commands
  if (apiName === 'clx') {
    const handled = await handleClxCommands(args, globalOpts);
    if (handled) return;

    // Check if first arg is an installed API (for development)
    if (args.length > 0) {
      const potentialApi = args[0];
      const spec = loadSpec(potentialApi);
      if (spec) {
        process.argv = [process.argv[0], potentialApi, ...args.slice(1)];
        await runApiCli(potentialApi, args.slice(1), globalOpts);
        return;
      }

      // Suggest similar commands
      const allCommands = ['install', 'remove', 'list', 'update', 'search', 'add', 'doctor', 'setup', 'completions', 'help', 'version'];
      const installed = listInstalledSpecs();
      const suggestion = suggestCommand(potentialApi, [...allCommands, ...installed]);

      console.log(error(`Unknown command: ${potentialApi}`));
      if (suggestion) {
        console.log('');
        console.log(`    Did you mean: ${cyan(suggestion)}`);
      }
      console.log('');
      console.log(`    Run '${cyan('clx --help')}' for available commands.`);
      process.exit(ExitCode.NOT_FOUND);
    }

    printClxHelp();
    return;
  }

  // Running as an API CLI (e.g., 'stripe')
  await runApiCli(apiName, args, globalOpts);
}

async function runApiCli(apiName: string, args: string[], globalOpts: GlobalOptions): Promise<void> {
  // Try to load adapter (bundled or user-installed)
  const adapter = loadAdapter(apiName);

  // Get spec from adapter or fall back to user-installed spec
  let spec: OpenAPISpec | null = adapter?.specData || loadSpec(apiName);

  if (!spec) {
    // First-run: offer to install
    if (isFirstRun() || !fs.existsSync(getConfigDir())) {
      const handled = await handleFirstRun(apiName);
      if (handled) return;
    }

    // Check if there's a bundled adapter but spec is missing
    if (hasBundledAdapter(apiName)) {
      if (globalOpts.json) {
        console.log(JSON.stringify(formatErrorJson(new UsageError(`API '${apiName}' spec not found. Run 'bun run update-spec ${apiName}' to fetch it.`))));
      } else {
        console.log(error(`API '${apiName}' spec not found`));
        console.log('');
        console.log(`    Run '${cyan(`bun run update-spec ${apiName}`)}' to fetch the spec.`);
      }
    } else {
      if (globalOpts.json) {
        console.log(JSON.stringify(formatErrorJson(new UsageError(`API '${apiName}' is not installed.`))));
      } else {
        console.log(error(`API '${apiName}' is not installed`));
        console.log('');
        console.log(`    Run '${cyan(`clx install ${apiName}`)}' to install it.`);
      }
    }
    process.exit(ExitCode.NOT_FOUND);
  }

  // Handle auth subcommand
  if (args[0] === 'auth') {
    await handleAuthCommand(apiName, spec, args.slice(1));
    return;
  }

  // Build command tree
  const tree = buildCommandTree(spec);

  // Parse arguments
  const { flags, positional } = parseArgs(args);

  // Check for help flag at any level
  const showHelp = flags.has('help') || flags.has('h');

  // Navigate to the target node
  const { node, path, remaining } = navigateTree(tree, positional);

  // Parse remaining arguments
  const { flags: opFlags } = parseArgs(remaining);

  // Merge flags
  for (const [k, v] of opFlags) {
    flags.set(k, v);
  }

  // Determine what to show/execute
  const lastPathItem = path[path.length - 1];
  const operation = node.operations.get(lastPathItem);

  if (showHelp || args.length === 0) {
    if (operation) {
      console.log(generateOperationHelp(apiName, path.slice(0, -1), lastPathItem, operation, spec));
    } else if (path.length === 0) {
      console.log(generateRootHelp(apiName, tree));
    } else {
      console.log(generateResourceHelp(apiName, path, node));
    }
    return;
  }

  // Execute operation
  if (!operation) {
    if (node.children.size > 0 || node.operations.size > 0) {
      console.log(generateResourceHelp(apiName, path, node));
    } else {
      if (globalOpts.json) {
        console.log(JSON.stringify({ error: { type: 'not_found', message: `Unknown command: ${positional.join(' ')}` } }));
      } else {
        console.log(error(`Unknown command: ${positional.join(' ')}`));
        console.log('');
        console.log(`    Run '${cyan(`${apiName} --help`)}' for available commands.`);
      }
      process.exit(ExitCode.NOT_FOUND);
    }
    return;
  }

  // Get profile name from --profile flag
  const profileName = flags.get('profile');

  // Load auth profile and ensure token is valid (handles OAuth refresh)
  const auth = await ensureValidToken(apiName, profileName);

  // Get base URL: adapter config > registry override > spec servers
  let baseUrl: string | null = null;
  if (adapter) {
    baseUrl = getAdapterBaseUrl(adapter, { profile: profileName });
  }
  if (!baseUrl) {
    const registryEntry = getRegistryEntry(apiName);
    baseUrl = getBaseUrl(spec, registryEntry?.baseUrl);
  }

  if (!baseUrl) {
    if (globalOpts.json) {
      console.log(JSON.stringify({ error: { type: 'config', message: 'No server URL found in API spec.' } }));
    } else {
      console.log(error('No server URL found in API spec'));
      console.log('');
      console.log(`    The spec may use a relative URL. Configure a base URL in your config.`);
    }
    process.exit(ExitCode.CONFIG_ERROR);
  }

  // Create execution context
  const ctx: ExecutionContext = {
    apiName,
    spec,
    auth: auth || undefined,
    baseUrl,
    dryRun: flags.has('dry-run'),
    verbose: globalOpts.verbose || flags.has('verbose') || flags.has('v'),
    profileName,
  };

  // Read stdin data if available
  const stdinData = await readStdin();

  try {
    // Build request
    const request = buildRequest(ctx, operation, flags, stdinData);

    // Dry run mode
    if (ctx.dryRun) {
      console.log(generateCurl(request));
      return;
    }

    // Execute request
    const { status, data } = await executeRequest(request, ctx.verbose);

    // Format output based on flags
    const outputFormat = flags.get('output') as 'json' | 'table' | undefined;
    const fieldPath = flags.get('field');

    // Quiet mode: only output data for successful requests
    if (globalOpts.quiet && status >= 200 && status < 300) {
      if (fieldPath) {
        const extracted = formatOutput(data, { format: 'json', field: fieldPath, pretty: false });
        console.log(extracted);
      } else {
        console.log(JSON.stringify(data));
      }
      return;
    }

    const output = formatOutput(data, {
      format: outputFormat || (globalOpts.json ? 'json' : 'json'),
      field: fieldPath,
      pretty: !flags.has('compact'),
    });

    console.log(output);

    // Exit with error code for non-2xx responses
    if (status < 200 || status >= 300) {
      process.exit(ExitCode.GENERAL_ERROR);
    }
  } catch (err) {
    if (globalOpts.json) {
      console.log(JSON.stringify(formatErrorJson(err)));
    } else {
      const { message, exitCode } = formatError(err);
      console.error(message);
    }
    process.exit(err instanceof ClxError ? err.exitCode : ExitCode.GENERAL_ERROR);
  }
}

// Run
main().then(() => {
  // Check for updates after successful execution
  checkForUpdates();
}).catch((err) => {
  const { message, exitCode } = formatError(err);
  console.error(message);
  process.exit(exitCode);
});
