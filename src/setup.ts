// Shell integration setup wizard
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getBinDir } from './config.js';
import { success, warning, error, info, bold, dim, cyan, confirm, isTTY, symbols } from './ui.js';

type ShellType = 'bash' | 'zsh' | 'fish' | 'unknown';

interface ShellConfig {
  type: ShellType;
  configFile: string;
  pathExport: string;
}

// Detect shell from $SHELL environment variable
export function detectShell(): ShellConfig {
  const shell = process.env.SHELL || '';
  const home = os.homedir();

  if (shell.includes('zsh')) {
    return {
      type: 'zsh',
      configFile: path.join(home, '.zshrc'),
      pathExport: `export PATH="$HOME/.local/bin:$PATH"`,
    };
  }

  if (shell.includes('bash')) {
    // On macOS, prefer .bash_profile if .bashrc doesn't exist
    const bashrc = path.join(home, '.bashrc');
    const bashProfile = path.join(home, '.bash_profile');
    const configFile = process.platform === 'darwin' && !fs.existsSync(bashrc) && fs.existsSync(bashProfile)
      ? bashProfile
      : bashrc;
    return {
      type: 'bash',
      configFile,
      pathExport: `export PATH="$HOME/.local/bin:$PATH"`,
    };
  }

  if (shell.includes('fish')) {
    return {
      type: 'fish',
      configFile: path.join(home, '.config', 'fish', 'config.fish'),
      pathExport: `set -gx PATH $HOME/.local/bin $PATH`,
    };
  }

  return {
    type: 'unknown',
    configFile: path.join(home, '.profile'),
    pathExport: `export PATH="$HOME/.local/bin:$PATH"`,
  };
}

// Check if bin directory is in PATH
export function isInPath(binDir?: string): boolean {
  const dir = binDir || getBinDir();
  const pathDirs = (process.env.PATH || '').split(path.delimiter);

  // Check both the exact path and with ~ expansion
  const homeDir = os.homedir();
  return pathDirs.some(p => {
    const normalized = p.replace(/^~/, homeDir);
    return normalized === dir || p === dir;
  });
}

// Check if PATH export is already in config file
function isAlreadyConfigured(configFile: string, pathExport: string): boolean {
  if (!fs.existsSync(configFile)) {
    return false;
  }

  const content = fs.readFileSync(configFile, 'utf-8');

  // Check for common PATH configurations
  const patterns = [
    /\.local\/bin/,
    /CLX_BIN/,
    /clx.*bin/i,
  ];

  return patterns.some(p => p.test(content));
}

// Add PATH export to shell config
function addToConfig(configFile: string, pathExport: string): void {
  // Ensure directory exists (for fish)
  const dir = path.dirname(configFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Append to file
  const content = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf-8') : '';
  const newContent = content.endsWith('\n') || content === ''
    ? `${content}# Added by clx\n${pathExport}\n`
    : `${content}\n\n# Added by clx\n${pathExport}\n`;

  fs.writeFileSync(configFile, newContent);
}

// Remove clx PATH from shell config
function removeFromConfig(configFile: string): boolean {
  if (!fs.existsSync(configFile)) {
    return false;
  }

  const content = fs.readFileSync(configFile, 'utf-8');
  const lines = content.split('\n');
  const filtered: string[] = [];
  let inClxBlock = false;
  let modified = false;

  for (const line of lines) {
    if (line.includes('# Added by clx')) {
      inClxBlock = true;
      modified = true;
      continue;
    }
    if (inClxBlock && (line.includes('.local/bin') || line.includes('CLX_BIN'))) {
      inClxBlock = false;
      continue;
    }
    inClxBlock = false;
    filtered.push(line);
  }

  if (modified) {
    fs.writeFileSync(configFile, filtered.join('\n'));
  }

  return modified;
}

export interface SetupOptions {
  shell?: string;
  yes?: boolean;
  check?: boolean;
  uninstall?: boolean;
  json?: boolean;
}

export async function runSetup(options: SetupOptions = {}): Promise<void> {
  const binDir = getBinDir();

  // Force specific shell if provided
  let shellConfig = detectShell();
  if (options.shell) {
    const forcedShell = options.shell.toLowerCase() as ShellType;
    if (['bash', 'zsh', 'fish'].includes(forcedShell)) {
      shellConfig = detectShell();
      shellConfig.type = forcedShell;
      if (forcedShell === 'fish') {
        shellConfig.configFile = path.join(os.homedir(), '.config', 'fish', 'config.fish');
        shellConfig.pathExport = `set -gx PATH $HOME/.local/bin $PATH`;
      } else {
        shellConfig.configFile = path.join(os.homedir(), forcedShell === 'zsh' ? '.zshrc' : '.bashrc');
        shellConfig.pathExport = `export PATH="$HOME/.local/bin:$PATH"`;
      }
    }
  }

  // JSON output mode
  if (options.json) {
    const result = {
      shell: shellConfig.type,
      configFile: shellConfig.configFile,
      binDir,
      inPath: isInPath(binDir),
      configured: isAlreadyConfigured(shellConfig.configFile, shellConfig.pathExport),
    };
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Check mode - just verify status
  if (options.check) {
    const inPath = isInPath(binDir);
    if (inPath) {
      console.log(success(`${binDir} is in PATH`));
      process.exit(0);
    } else {
      console.log(warning(`${binDir} is not in PATH`));
      process.exit(1);
    }
  }

  // Uninstall mode
  if (options.uninstall) {
    const removed = removeFromConfig(shellConfig.configFile);
    if (removed) {
      console.log(success(`Removed clx from ${shellConfig.configFile}`));
      console.log('');
      console.log(`  Restart your terminal to apply changes.`);
    } else {
      console.log(info(`No clx configuration found in ${shellConfig.configFile}`));
    }
    return;
  }

  // Interactive setup
  console.log('');
  console.log(`  ${bold(cyan(symbols.info))} ${bold('Shell Setup')}`);
  console.log('');
  console.log(`  Detected shell: ${bold(shellConfig.type)}`);
  console.log(`  Config file: ${dim(shellConfig.configFile)}`);
  console.log('');

  // Check if already in PATH
  if (isInPath(binDir)) {
    console.log(success(`${binDir} is already in your PATH`));
    console.log('');
    console.log(`  No changes needed.`);
    return;
  }

  // Check if already configured (might just need restart)
  if (isAlreadyConfigured(shellConfig.configFile, shellConfig.pathExport)) {
    console.log(warning(`${binDir} is configured but not in PATH`));
    console.log('');
    console.log(`  Your shell config already has the PATH setup.`);
    console.log(`  Restart your terminal or run:`);
    console.log(`    ${cyan(`source ${shellConfig.configFile}`)}`);
    return;
  }

  console.log(warning(`${binDir} is not in your PATH.`));
  console.log('');

  // Ask for confirmation (unless --yes)
  const shouldAdd = options.yes || await confirm('Add clx to your PATH?', true);

  if (!shouldAdd) {
    console.log('');
    console.log(`  ${dim('Skipped. Add manually:')}`);
    console.log(`    ${cyan(shellConfig.pathExport)}`);
    return;
  }

  // Add to config
  try {
    addToConfig(shellConfig.configFile, shellConfig.pathExport);
    console.log('');
    console.log(success(`Added to ${shellConfig.configFile}:`));
    console.log(`    ${cyan(shellConfig.pathExport)}`);
    console.log('');
    console.log(`  Run this to apply now:`);
    console.log(`    ${cyan(`source ${shellConfig.configFile}`)}`);
    console.log('');
    console.log(`  Or restart your terminal.`);
  } catch (err) {
    console.log('');
    console.log(error(`Failed to update ${shellConfig.configFile}`));
    console.log(`    ${dim(err instanceof Error ? err.message : String(err))}`);
    console.log('');
    console.log(`  Add manually:`);
    console.log(`    ${cyan(shellConfig.pathExport)}`);
    process.exit(1);
  }
}

// Print PATH warning (for use after install)
export function printPathWarning(): void {
  const binDir = getBinDir();
  if (isInPath(binDir)) {
    return;
  }

  console.log('');
  console.log(warning(`${binDir} is not in your PATH`));
  console.log('');
  console.log(`  Run '${cyan('clx setup')}' to fix this, or add manually:`);
  console.log(`    ${cyan(`export PATH="${binDir}:$PATH"`)}`);
}
