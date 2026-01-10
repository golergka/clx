// CLI program definition using commander
// This handles argument parsing for the main clx command

import { Command } from 'commander';
import { getVersion } from './update.js';
import { listAvailableApis, listInstalledApis, hasBundledAdapter, downloadSpec, isSpecInstalled, removeSpec as removeSpecFile } from './adapter-loader.js';
import { runDiagnostics, printDiagnostics, type DoctorOptions } from './doctor.js';
import { runSetup, type SetupOptions } from './setup.js';
import { handleCompletions } from './completions.js';
import { ensureBinDir, isPathConfigured, createApiSymlink, removeApiSymlink } from './checks.js';
import { success, warning, error, info, bold, dim, cyan, confirm, isTTY } from './ui.js';
import { ExitCode } from './errors.js';

const VERSION = getVersion();

export interface GlobalOptions {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  yes?: boolean;
}

export function createClxProgram(): Command {
  const program = new Command();

  program
    .name('clx')
    .description('CLI API Client Generator')
    .version(VERSION, '-V, --version', 'Show version')
    .option('--json', 'Output in JSON format')
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('-v, --verbose', 'Show detailed output')
    .option('-y, --yes', 'Skip confirmation prompts')
    .configureHelp({
      sortSubcommands: true,
    });

  // Install command
  program
    .command('install <api>')
    .description('Install an API')
    .action(async (apiName: string) => {
      const opts = program.opts() as GlobalOptions;
      await installCommand(apiName, opts);
    });

  // Remove/uninstall command
  program
    .command('remove <api>')
    .alias('uninstall')
    .description('Remove an installed API')
    .action(async (apiName: string) => {
      const opts = program.opts() as GlobalOptions;
      await removeCommand(apiName, opts);
    });

  // List command
  program
    .command('list')
    .alias('ls')
    .description('List installed and available APIs')
    .option('-a, --all', 'Show all available APIs')
    .action(async (cmdOpts: { all?: boolean }) => {
      const opts = program.opts() as GlobalOptions;
      await listCommand({ ...opts, all: cmdOpts.all });
    });

  // Doctor command
  program
    .command('doctor')
    .description('Run diagnostic checks')
    .option('--fix', 'Auto-fix issues where possible')
    .action(async (cmdOpts: { fix?: boolean }) => {
      const opts = program.opts() as GlobalOptions;
      const doctorOpts: DoctorOptions = {
        json: opts.json,
        fix: cmdOpts.fix,
      };
      const results = await runDiagnostics(doctorOpts);
      printDiagnostics(results, doctorOpts);
    });

  // Setup command
  program
    .command('setup')
    .description('Configure shell integration')
    .option('--shell <shell>', 'Specify shell (bash, zsh, fish)')
    .option('--check', 'Only check, don\'t modify')
    .option('--uninstall', 'Remove clx from shell config')
    .action(async (cmdOpts: { shell?: string; check?: boolean; uninstall?: boolean }) => {
      const opts = program.opts() as GlobalOptions;
      const setupOpts: SetupOptions = {
        shell: cmdOpts.shell,
        yes: opts.yes,
        check: cmdOpts.check,
        uninstall: cmdOpts.uninstall,
        json: opts.json,
      };
      await runSetup(setupOpts);
    });

  // Completions command
  program
    .command('completions [shell]')
    .description('Generate shell completions')
    .action((shell?: string) => {
      handleCompletions(shell ? [shell] : []);
    });

  // Help command - delegate to API help if topic is an installed API
  program
    .command('help [topic]')
    .description('Show help for clx or an installed API')
    .action(async (topic?: string) => {
      if (topic) {
        // Check if topic is an installed API
        const installed = listInstalledApis();
        if (installed.includes(topic)) {
          // Import and run API CLI with --help
          // This will be handled by index.ts runApiCli
          console.log(`Run 'clx ${topic} --help' or '${topic} --help' to see API help`);
          return;
        }
        // Check if it's a clx subcommand
        const subcmd = program.commands.find(c => c.name() === topic);
        if (subcmd) {
          subcmd.outputHelp();
          return;
        }
        console.log(error(`Unknown topic: ${topic}`));
        console.log(`    Run 'clx --help' for available commands`);
        console.log(`    Run 'clx list' to see installed APIs`);
      } else {
        program.outputHelp();
      }
    });

  return program;
}

async function installCommand(apiName: string, opts: GlobalOptions): Promise<void> {
  // Check if API has a bundled adapter
  if (!hasBundledAdapter(apiName)) {
    if (opts.json) {
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
    if (opts.json) {
      console.log(JSON.stringify({ status: 'already_installed', api: apiName }));
    } else {
      console.log(info(`${apiName} is already installed`));
    }
    return;
  }

  // Download spec from clx repo
  if (!opts.quiet) {
    console.log(`Installing ${apiName}...`);
  }

  const ok = await downloadSpec(apiName);
  if (!ok) {
    if (opts.json) {
      console.log(JSON.stringify({ error: { type: 'download_failed', message: `Failed to download spec for ${apiName}` } }));
    } else {
      console.log(error(`Failed to download spec for ${apiName}`));
    }
    process.exit(ExitCode.NETWORK_ERROR);
  }

  // Ensure bin directory exists and is writable
  if (!ensureBinDir()) {
    if (!opts.quiet) {
      console.log(warning(`Bin directory not writable`));
      console.log(dim(`  Run 'clx doctor' to diagnose`));
    }
  }

  // Create symlink
  const symlinkCreated = createApiSymlink(apiName);
  if (!symlinkCreated && !opts.quiet) {
    console.log(warning(`Could not create symlink`));
    console.log(dim(`  Run 'clx doctor --fix' to diagnose`));
  }

  if (opts.json) {
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
}

async function removeCommand(apiName: string, opts: GlobalOptions): Promise<void> {
  if (!isSpecInstalled(apiName)) {
    if (opts.json) {
      console.log(JSON.stringify({ error: { type: 'not_found', message: `API '${apiName}' is not installed` } }));
    } else {
      console.log(error(`API '${apiName}' is not installed`));
    }
    process.exit(ExitCode.NOT_FOUND);
  }

  // Confirm removal
  if (!opts.yes && isTTY) {
    const confirmed = await confirm(`Remove ${apiName}?`);
    if (!confirmed) {
      console.log('Cancelled.');
      return;
    }
  }

  // Remove spec
  removeSpecFile(apiName);

  // Remove symlink
  removeApiSymlink(apiName);

  if (opts.json) {
    console.log(JSON.stringify({ status: 'removed', api: apiName }));
  } else {
    console.log(success(`Removed ${apiName}`));
  }
}

async function listCommand(opts: GlobalOptions & { all?: boolean }): Promise<void> {
  const installed = listInstalledApis();
  const available = listAvailableApis();
  const notInstalled = available.filter(a => !installed.includes(a));

  if (opts.json) {
    if (opts.all) {
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
        // We'd need to load adapter to get help.summary, keeping it simple for now
        console.log(`  ${name}`);
      }
    }

    console.log('');

    if (opts.all) {
      if (notInstalled.length > 0) {
        console.log(`  Available (${notInstalled.length}):`);
        console.log(`  ${notInstalled.join(', ')}`);
      }
    } else {
      if (notInstalled.length > 0) {
        console.log(`  ${notInstalled.length} more APIs available. Run 'clx list --all' to see all.`);
      }
    }
  }
}

/**
 * Parse raw arguments, handling bun's compiled binary quirks
 */
export function parseRawArgs(): { apiName: string; args: string[] } {
  const argv1 = process.argv[1] || '';
  const basename = require('path').basename(argv1);

  // Determine API name from binary name
  let apiName = 'clx';
  if (!basename.endsWith('.ts') && basename !== 'index.js') {
    apiName = basename;
  }

  // Get arguments, skipping the bun binary name quirk
  let args = process.argv.slice(2);

  // Bun compiled binaries pass the binary name as an extra argument
  // e.g., ["bun", "/$bunfs/root/clx", "clx", ...actual args]
  if (args.length > 0 && args[0] === apiName) {
    args = args.slice(1);
  }

  return { apiName, args };
}
