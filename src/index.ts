#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import type { OpenAPISpec, CommandNode, ExecutionContext } from './types.js';
import { loadSpec, getAuthProfile, ensureConfigDirs, listInstalledSpecs } from './config.js';
import { buildCommandTree, getBaseUrl } from './parser.js';
import { generateRootHelp, generateResourceHelp, generateOperationHelp } from './help.js';
import { parseArgs, buildRequest, executeRequest, generateCurl } from './executor.js';
import { authLogin, authStatus, authLogout, authList, authSwitch, ensureValidToken } from './auth.js';
import { searchRegistry, installApi, listApis, updateApi, removeApi, addLocalSpec, getRegistryEntry } from './registry.js';
import { formatOutput } from './output.js';
import { runDiagnostics, printDiagnostics } from './doctor.js';
import { generateCompletion } from './completions.js';
import { formatError, ExitCode, ClxError, UsageError } from './errors.js';

// Get API name from argv[0] (busybox pattern)
function getApiName(): string {
  const argv0 = process.argv[1];
  const basename = path.basename(argv0);

  // Handle .ts extension during development
  if (basename.endsWith('.ts')) {
    return 'clx';
  }

  return basename;
}

// Read stdin if available (non-blocking check)
async function readStdin(): Promise<string | undefined> {
  // Check if stdin is a TTY (interactive terminal)
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

    // Start reading
    process.stdin.resume();
  });
}

// Handle clx package manager commands
async function handleClxCommands(args: string[]): Promise<boolean> {
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
      console.log('clx version 0.1.0');
      return true;

    case 'install': {
      if (rest.length === 0) {
        console.error('Usage: clx install <api|url|file> [--name <name>]');
        process.exit(1);
      }
      const { flags, positional } = parseArgs(rest);
      const name = flags.get('name');
      await installApi(positional[0], name);
      return true;
    }

    case 'remove':
    case 'uninstall': {
      if (rest.length === 0) {
        console.error('Usage: clx remove <api>');
        process.exit(1);
      }
      removeApi(rest[0]);
      return true;
    }

    case 'list':
    case 'ls':
      listApis();
      return true;

    case 'update': {
      const { flags, positional } = parseArgs(rest);
      if (flags.has('all')) {
        // Update all installed APIs
        const installed = listInstalledSpecs();
        if (installed.length === 0) {
          console.log('No APIs installed.');
          return true;
        }
        console.log(`Updating ${installed.length} API(s)...`);
        for (const api of installed) {
          try {
            await updateApi(api);
          } catch (error) {
            console.error(`Failed to update ${api}: ${error instanceof Error ? error.message : error}`);
          }
        }
        return true;
      }
      if (positional.length === 0) {
        console.error('Usage: clx update <api> or clx update --all');
        process.exit(1);
      }
      await updateApi(positional[0]);
      return true;
    }

    case 'doctor': {
      const results = await runDiagnostics();
      printDiagnostics(results);
      return true;
    }

    case 'completion': {
      if (rest.length === 0) {
        console.error('Usage: clx completion <bash|zsh|fish>');
        console.error('Example: eval "$(clx completion bash)"');
        process.exit(1);
      }
      try {
        const script = generateCompletion(rest[0]);
        console.log(script);
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
      return true;
    }

    case 'search': {
      if (rest.length === 0) {
        // Show all available
        searchRegistry('');
      } else {
        searchRegistry(rest[0]);
      }
      return true;
    }

    case 'add': {
      if (rest.length === 0) {
        console.error('Usage: clx add <file> --name <name>');
        process.exit(1);
      }
      const { flags, positional } = parseArgs(rest);
      const name = flags.get('name');
      if (!name) {
        console.error('--name is required for local specs');
        process.exit(1);
      }
      addLocalSpec(positional[0], name);
      return true;
    }

    default:
      return false;
  }
}

function printClxHelp(): void {
  console.log(`clx - CLI API Client Generator

Usage:
  clx <command> [options]

Package Management:
  install <api>       Install an API from registry
  install <url>       Install an API from URL
  install <file>      Install an API from local file
  remove <api>        Remove an installed API
  list                List installed APIs
  update <api>        Update an API to latest version
  update --all        Update all installed APIs
  search [query]      Search available APIs
  add <file> --name   Add a local OpenAPI spec

Utilities:
  doctor              Run diagnostic checks
  completion <shell>  Generate shell completion (bash, zsh, fish)

Options:
  --help              Show this help
  --version           Show version

Examples:
  clx install stripe
  clx install https://api.example.com/openapi.yaml --name myapi
  clx add ./spec.yaml --name myapi
  clx list
  clx remove stripe
  clx doctor
  eval "$(clx completion bash)"

After installing, use the API name as a command:
  stripe --help
  stripe customers list --output=table
  stripe customers get cus_123 --field=email
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

    // Stop at flags
    if (arg.startsWith('-')) {
      break;
    }

    // Check for child node
    if (current.children.has(arg)) {
      current = current.children.get(arg)!;
      path.push(arg);
      i++;
      continue;
    }

    // Check for operation
    if (current.operations.has(arg)) {
      path.push(arg);
      i++;
      break;
    }

    // Unknown argument - stop here
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
        console.error('Usage: auth switch <profile-name>');
        process.exit(1);
      }
      authSwitch(apiName, positional[1]);
      break;
    default:
      console.log(`${apiName} auth <command> [--profile <name>]

Commands:
  login [--profile <name>]    Configure authentication
  status [--profile <name>]   Show current auth status
  logout [--profile <name>]   Clear credentials (all if no profile specified)
  list                        List all profiles
  switch <name>               Set default profile

Examples:
  ${apiName} auth login                    # Login with default profile
  ${apiName} auth login --profile prod     # Login with 'prod' profile
  ${apiName} auth list                     # Show all profiles
  ${apiName} auth switch prod              # Set 'prod' as default
`);
  }
}

// Main execution
async function main(): Promise<void> {
  const apiName = getApiName();
  const args = process.argv.slice(2);

  // If running as 'clx', handle package manager commands
  if (apiName === 'clx') {
    const handled = await handleClxCommands(args);
    if (handled) return;

    // Check if first arg is an installed API (for development)
    if (args.length > 0) {
      const potentialApi = args[0];
      const spec = loadSpec(potentialApi);
      if (spec) {
        // Recurse with the API as if called directly
        process.argv = [process.argv[0], potentialApi, ...args.slice(1)];
        await runApiCli(potentialApi, args.slice(1));
        return;
      }
    }

    console.error(`Unknown command: ${args[0]}`);
    console.error(`Run 'clx --help' for usage.`);
    process.exit(1);
  }

  // Running as an API CLI (e.g., 'stripe')
  await runApiCli(apiName, args);
}

async function runApiCli(apiName: string, args: string[]): Promise<void> {
  // Load the spec
  const spec = loadSpec(apiName);

  if (!spec) {
    console.error(`API '${apiName}' is not installed.`);
    console.error(`Run 'clx install ${apiName}' to install it.`);
    process.exit(1);
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
    // Maybe the last path item is a resource, show its help
    if (node.children.size > 0 || node.operations.size > 0) {
      console.log(generateResourceHelp(apiName, path, node));
    } else {
      console.error(`Unknown command: ${positional.join(' ')}`);
      console.error(`Run '${apiName} --help' for available commands.`);
      process.exit(1);
    }
    return;
  }

  // Get profile name from --profile flag
  const profileName = flags.get('profile');

  // Load auth profile and ensure token is valid (handles OAuth refresh)
  const auth = await ensureValidToken(apiName, profileName);

  // Get base URL, using registry override if spec has relative URL
  const registryEntry = getRegistryEntry(apiName);
  const baseUrl = getBaseUrl(spec, registryEntry?.baseUrl);

  if (!baseUrl) {
    console.error('No server URL found in API spec.');
    console.error('If the spec uses a relative URL, you may need to configure a base URL.');
    process.exit(1);
  }

  // Create execution context
  const ctx: ExecutionContext = {
    apiName,
    spec,
    auth: auth || undefined,
    baseUrl,
    dryRun: flags.has('dry-run'),
    verbose: flags.has('verbose') || flags.has('v'),
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
    const output = formatOutput(data, {
      format: outputFormat || 'json',
      field: fieldPath,
      pretty: !flags.has('compact'),
    });

    console.log(output);

    // Exit with error code for non-2xx responses
    if (status < 200 || status >= 300) {
      process.exit(1);
    }
  } catch (error) {
    const { message, exitCode } = formatError(error);
    console.error(message);
    process.exit(exitCode);
  }
}

// Run
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
