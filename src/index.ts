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
import { runSetup, isInPath, type SetupOptions } from './setup.js';
import { formatError, formatErrorJson, ExitCode, ClxError, UsageError, suggestCommand } from './errors.js';
import { success, warning, error, info, bold, dim, cyan, confirm, isTTY, box } from './ui.js';
import { checkForUpdates, getVersion } from './update.js';
import { loadAdapter, hasBundledAdapter, getAdapterBaseUrl, listAvailableApis, listInstalledApis, downloadSpec, isSpecInstalled, removeSpec as removeSpecFile, getUserBinDir } from './adapter-loader.js';
import { ensureBinDir, isPathConfigured, createApiSymlink, removeApiSymlink } from './checks.js';
import { createClxProgram, parseRawArgs, type GlobalOptions } from './cli.js';
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

// Note: GlobalOptions is now imported from cli.ts
// Note: handleClxCommands and printClxHelp replaced by commander-based CLI in cli.ts

// Navigate result with optional error info
interface NavigateResult {
  node: CommandNode;
  path: string[];
  remaining: string[];
  unknownCommand?: string;  // If set, an unknown command was encountered
}

// Navigate the command tree based on arguments
function navigateTree(
  tree: CommandNode,
  args: string[]
): NavigateResult {
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

    // Unknown command - check if it looks like a command (not a flag value)
    if (!arg.startsWith('-') && (current.children.size > 0 || current.operations.size > 0)) {
      return { node: current, path, remaining: args.slice(i + 1), unknownCommand: arg };
    }

    break;
  }

  return { node: current, path, remaining: args.slice(i) };
}

// Handle auth subcommands
async function handleAuthCommand(apiName: string, spec: OpenAPISpec, args: string[]): Promise<void> {
  const { flags, positional } = parseArgs(args);  // customHeaders not needed for auth
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
  // Debug: log argv to understand what's happening
  if (process.env.CLX_DEBUG) {
    console.error('[DEBUG] process.argv:', process.argv);
  }

  // Parse raw arguments handling bun's quirks
  const { apiName, args } = parseRawArgs();

  // First-run experience
  if (isFirstRun() && apiName === 'clx') {
    const handled = await handleFirstRun();
    if (handled) return;
  }

  // If running as 'clx', use commander for argument parsing
  if (apiName === 'clx') {
    // Check if first arg might be an installed API (for development: `clx stripe ...`)
    if (args.length > 0) {
      const potentialApi = args[0];
      // Skip if it looks like a flag or known command
      if (!potentialApi.startsWith('-')) {
        const knownCommands = ['install', 'remove', 'uninstall', 'list', 'ls', 'doctor', 'setup', 'completions', 'help', 'version'];
        if (!knownCommands.includes(potentialApi)) {
          // Check new adapter system first, then fall back to old spec system
          const adapter = loadAdapter(potentialApi);
          const spec = adapter?.specData || loadSpec(potentialApi);
          if (spec) {
            // Run as API CLI
            const globalOpts = parseGlobalOptsFromArgs(args.slice(1));
            await runApiCli(potentialApi, args.slice(1), globalOpts);
            return;
          }
        }
      }
    }

    // Use commander for clx commands
    const program = createClxProgram();
    await program.parseAsync(['node', 'clx', ...args]);
    return;
  }

  // Running as an API CLI (e.g., 'stripe')
  const globalOpts = parseGlobalOptsFromArgs(args);
  await runApiCli(apiName, args, globalOpts);
}

// Simple global options parser for API CLI mode
function parseGlobalOptsFromArgs(args: string[]): GlobalOptions {
  const opts: GlobalOptions = {};
  for (const arg of args) {
    if (arg === '--json') opts.json = true;
    else if (arg === '-q' || arg === '--quiet') opts.quiet = true;
    else if (arg === '-v' || arg === '--verbose') opts.verbose = true;
    else if (arg === '-y' || arg === '--yes') opts.yes = true;
  }
  return opts;
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
  const { flags, positional, customHeaders } = parseArgs(args);

  // Check for help flag at any level
  const showHelp = flags.has('help') || flags.has('h');

  // Navigate to the target node
  const { node, path, remaining, unknownCommand } = navigateTree(tree, positional);

  // Handle unknown command error
  if (unknownCommand) {
    const available = [...node.children.keys(), ...node.operations.keys()];
    const suggestion = suggestCommand(unknownCommand, available);
    const fullPath = path.length > 0 ? `${apiName} ${path.join(' ')}` : apiName;

    if (globalOpts.json) {
      console.log(JSON.stringify({
        error: {
          type: 'unknown_command',
          command: unknownCommand,
          suggestion,
          available: available.slice(0, 10),
        }
      }));
    } else {
      console.log(error(`Unknown command: '${unknownCommand}'`));
      if (suggestion) {
        console.log(`    Did you mean '${cyan(suggestion)}'?`);
      }
      console.log('');
      console.log(`    Available: ${available.slice(0, 5).join(', ')}${available.length > 5 ? '...' : ''}`);
      console.log(`    Run '${cyan(`${fullPath} --help`)}' for all commands.`);
    }
    process.exit(ExitCode.USAGE_ERROR);
  }

  // Parse remaining arguments
  const { flags: opFlags, customHeaders: opCustomHeaders } = parseArgs(remaining);

  // Merge flags
  for (const [k, v] of opFlags) {
    flags.set(k, v);
  }

  // Merge custom headers
  const allCustomHeaders = [...customHeaders, ...opCustomHeaders];

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
    const request = buildRequest(ctx, operation, flags, stdinData, allCustomHeaders);

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
    const fieldsFlag = flags.get('fields');
    const fields = fieldsFlag ? fieldsFlag.split(',').map(f => f.trim()) : undefined;
    const compact = flags.has('compact');
    const ids = flags.has('ids');

    // Quiet mode: only output data for successful requests
    if (globalOpts.quiet && status >= 200 && status < 300) {
      const extracted = formatOutput(data, { format: 'json', field: fieldPath, fields, pretty: false, compact: true, ids });
      console.log(extracted);
      return;
    }

    const output = formatOutput(data, {
      format: outputFormat || (globalOpts.json ? 'json' : 'json'),
      field: fieldPath,
      fields,
      pretty: !compact,
      compact,
      ids,
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
