// Shell completion scripts for bash, zsh, and fish

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { listInstalledSpecs, loadSpec } from './config.js';
import { buildCommandTree } from './parser.js';
import { success, warning, error, dim, cyan } from './ui.js';

// Generate bash completion script
export function generateBashCompletion(): string {
  return `# clx bash completion
# Add to ~/.bashrc: eval "$(clx completions bash)"

_clx_completions() {
    local cur prev words cword
    _init_completion || return

    local commands="install remove list update search add help version doctor setup completions"
    local apis=$(clx list --json 2>/dev/null | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | tr '\\n' ' ')

    case $cword in
        1)
            COMPREPLY=($(compgen -W "$commands $apis" -- "$cur"))
            ;;
        2)
            case "$prev" in
                install)
                    local available=$(clx search --json 2>/dev/null | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | tr '\\n' ' ')
                    COMPREPLY=($(compgen -W "$available" -- "$cur"))
                    ;;
                remove|update)
                    COMPREPLY=($(compgen -W "$apis" -- "$cur"))
                    ;;
                add)
                    _filedir '@(yaml|yml|json)'
                    ;;
                completions)
                    COMPREPLY=($(compgen -W "bash zsh fish install" -- "$cur"))
                    ;;
                setup)
                    COMPREPLY=($(compgen -W "--shell --yes --check --uninstall" -- "$cur"))
                    ;;
                *)
                    if echo "$apis" | grep -qw "$prev"; then
                        local subcommands=$(_clx_get_subcommands "$prev" "")
                        COMPREPLY=($(compgen -W "$subcommands auth --help --dry-run --verbose --json --quiet" -- "$cur"))
                    fi
                    ;;
            esac
            ;;
        *)
            local api_index=-1
            for ((i=1; i<cword; i++)); do
                if echo "$apis" | grep -qw "\${words[$i]}"; then
                    api_index=$i
                    break
                fi
            done

            if [[ $api_index -gt 0 ]]; then
                COMPREPLY=($(compgen -W "--help --dry-run --verbose --json --quiet --output --field" -- "$cur"))
            fi
            ;;
    esac
}

_clx_get_subcommands() {
    local api=$1
    echo "list get create update delete"
}

complete -F _clx_completions clx

# Complete for installed API commands
for api in $(clx list --json 2>/dev/null | grep -o '"name":"[^"]*"' | cut -d'"' -f4); do
    complete -F _clx_completions "$api"
done
`;
}

// Generate zsh completion script
export function generateZshCompletion(): string {
  return `#compdef clx
# clx zsh completion
# Add to ~/.zshrc: eval "$(clx completions zsh)"

_clx() {
    local -a commands apis
    commands=(
        'install:Install an API from registry'
        'remove:Remove an installed API'
        'list:List installed APIs'
        'update:Update an API'
        'search:Search available APIs'
        'add:Add a local OpenAPI spec'
        'doctor:Run diagnostic checks'
        'setup:Configure shell integration'
        'completions:Generate shell completions'
        'help:Show help'
        'version:Show version'
    )

    apis=($(clx list --json 2>/dev/null | grep -o '"name":"[^"]*"' | cut -d'"' -f4))

    _arguments -C \\
        '1: :->cmd' \\
        '*:: :->args'

    case $state in
        cmd)
            _describe -t commands 'clx command' commands
            _describe -t apis 'installed APIs' apis
            ;;
        args)
            case $words[1] in
                install)
                    local -a available
                    available=($(clx search --json 2>/dev/null | grep -o '"name":"[^"]*"' | cut -d'"' -f4))
                    _describe -t apis 'available APIs' available
                    ;;
                remove|update)
                    _describe -t apis 'installed APIs' apis
                    ;;
                add)
                    _files -g '*.{yaml,yml,json}'
                    ;;
                completions)
                    _values 'shell' bash zsh fish install
                    ;;
                setup)
                    _arguments \\
                        '--shell[Force specific shell]:shell:(bash zsh fish)' \\
                        '--yes[Non-interactive mode]' \\
                        '--check[Only check status]' \\
                        '--uninstall[Remove from shell config]'
                    ;;
                *)
                    if (( \${apis[(I)$words[1]]} )); then
                        _clx_api_commands
                    fi
                    ;;
            esac
            ;;
    esac
}

_clx_api_commands() {
    local -a subcommands options
    subcommands=(
        'auth:Manage authentication'
    )
    options=(
        '--help:Show help'
        '--dry-run:Show curl command'
        '--verbose:Show details'
        '--json:JSON output'
        '--quiet:Suppress output'
        '--output:Output format'
        '--field:Extract field'
        '--profile:Auth profile'
    )
    _describe -t commands 'API command' subcommands
    _describe -t options 'options' options
}

compdef _clx clx

for api in $(clx list --json 2>/dev/null | grep -o '"name":"[^"]*"' | cut -d'"' -f4); do
    compdef _clx "$api"
done
`;
}

// Generate fish completion script
export function generateFishCompletion(): string {
  return `# clx fish completion
# Add to ~/.config/fish/completions/clx.fish or run: clx completions fish | source

complete -c clx -f

# Main commands
complete -c clx -n '__fish_use_subcommand' -a 'install' -d 'Install an API from registry'
complete -c clx -n '__fish_use_subcommand' -a 'remove' -d 'Remove an installed API'
complete -c clx -n '__fish_use_subcommand' -a 'list' -d 'List installed APIs'
complete -c clx -n '__fish_use_subcommand' -a 'update' -d 'Update an API'
complete -c clx -n '__fish_use_subcommand' -a 'search' -d 'Search available APIs'
complete -c clx -n '__fish_use_subcommand' -a 'add' -d 'Add a local OpenAPI spec'
complete -c clx -n '__fish_use_subcommand' -a 'doctor' -d 'Run diagnostic checks'
complete -c clx -n '__fish_use_subcommand' -a 'setup' -d 'Configure shell integration'
complete -c clx -n '__fish_use_subcommand' -a 'completions' -d 'Generate shell completions'
complete -c clx -n '__fish_use_subcommand' -a 'help' -d 'Show help'
complete -c clx -n '__fish_use_subcommand' -a 'version' -d 'Show version'

# Install completions
complete -c clx -n '__fish_seen_subcommand_from install' -a '(clx search --json 2>/dev/null | string match -r \'"name":"[^"]*"\' | string replace -r \'"name":"([^"]*)"\' \'$1\')'

# Remove/update completions
complete -c clx -n '__fish_seen_subcommand_from remove update' -a '(clx list --json 2>/dev/null | string match -r \'"name":"[^"]*"\' | string replace -r \'"name":"([^"]*)"\' \'$1\')'

# Completions shell options
complete -c clx -n '__fish_seen_subcommand_from completions' -a 'bash zsh fish install'

# Setup options
complete -c clx -n '__fish_seen_subcommand_from setup' -l shell -d 'Force specific shell'
complete -c clx -n '__fish_seen_subcommand_from setup' -l yes -d 'Non-interactive'
complete -c clx -n '__fish_seen_subcommand_from setup' -l check -d 'Check only'
complete -c clx -n '__fish_seen_subcommand_from setup' -l uninstall -d 'Remove config'

# Global options
complete -c clx -l help -d 'Show help'
complete -c clx -l json -d 'JSON output'
complete -c clx -l quiet -s q -d 'Suppress output'
complete -c clx -l verbose -s v -d 'Show details'

# Add installed APIs as commands
for api in (clx list --json 2>/dev/null | string match -r '"name":"[^"]*"' | string replace -r '"name":"([^"]*)"' '$1')
    complete -c clx -n '__fish_use_subcommand' -a "$api" -d "Use $api API"
    complete -c "$api" -f
    complete -c "$api" -n '__fish_use_subcommand' -a 'auth' -d 'Manage authentication'
    complete -c "$api" -l help -d 'Show help'
    complete -c "$api" -l dry-run -d 'Show curl command'
    complete -c "$api" -l verbose -s v -d 'Show details'
    complete -c "$api" -l json -d 'JSON output'
    complete -c "$api" -l quiet -s q -d 'Suppress output'
    complete -c "$api" -l output -a 'json table' -d 'Output format'
    complete -c "$api" -l field -d 'Extract field'
    complete -c "$api" -l profile -d 'Auth profile'
end
`;
}

// Get completion file path for a shell
function getCompletionPath(shell: string): string {
  const home = os.homedir();

  switch (shell) {
    case 'bash':
      // Check for bash-completion directories
      const bashDirs = [
        '/usr/local/etc/bash_completion.d',
        '/etc/bash_completion.d',
        path.join(home, '.local/share/bash-completion/completions'),
      ];
      for (const dir of bashDirs) {
        if (fs.existsSync(dir)) {
          return path.join(dir, 'clx');
        }
      }
      return path.join(home, '.local/share/bash-completion/completions/clx');

    case 'zsh':
      // Check for zsh completion directories
      const zshDirs = [
        '/usr/local/share/zsh/site-functions',
        path.join(home, '.zsh/completions'),
        path.join(home, '.local/share/zsh/site-functions'),
      ];
      for (const dir of zshDirs) {
        if (fs.existsSync(dir)) {
          return path.join(dir, '_clx');
        }
      }
      return path.join(home, '.zsh/completions/_clx');

    case 'fish':
      return path.join(home, '.config/fish/completions/clx.fish');

    default:
      throw new Error(`Unsupported shell: ${shell}`);
  }
}

// Install completions to the appropriate location
export function installCompletions(shell?: string): void {
  // Detect shell if not specified
  const detectedShell = shell || path.basename(process.env.SHELL || 'bash');
  const normalizedShell = detectedShell.toLowerCase();

  if (!['bash', 'zsh', 'fish'].includes(normalizedShell)) {
    console.log(error(`Unsupported shell: ${detectedShell}`));
    console.log(`    Supported shells: bash, zsh, fish`);
    process.exit(1);
  }

  const completionPath = getCompletionPath(normalizedShell);
  const completionDir = path.dirname(completionPath);

  // Ensure directory exists
  if (!fs.existsSync(completionDir)) {
    fs.mkdirSync(completionDir, { recursive: true });
  }

  // Generate and write completion script
  const script = generateCompletion(normalizedShell);
  fs.writeFileSync(completionPath, script);

  console.log(success(`Installed ${normalizedShell} completions`));
  console.log(dim(`    ${completionPath}`));
  console.log('');
  console.log(`  Restart your shell to enable completions.`);
}

// Generate completion for specified shell
export function generateCompletion(shell: string): string {
  switch (shell.toLowerCase()) {
    case 'bash':
      return generateBashCompletion();
    case 'zsh':
      return generateZshCompletion();
    case 'fish':
      return generateFishCompletion();
    default:
      throw new Error(`Unsupported shell: ${shell}. Use bash, zsh, or fish.`);
  }
}

export interface CompletionsOptions {
  install?: boolean;
}

// Handle completions command
export function handleCompletions(args: string[]): void {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`clx completions - Generate shell completions

Usage:
  clx completions <shell>      Print completion script to stdout
  clx completions install      Install completions for current shell

Shells:
  bash    Bash completion script
  zsh     Zsh completion script
  fish    Fish completion script

Examples:
  eval "$(clx completions bash)"     # Add to ~/.bashrc
  eval "$(clx completions zsh)"      # Add to ~/.zshrc
  clx completions fish | source      # Add to config.fish
  clx completions install            # Auto-install for current shell
`);
    return;
  }

  const arg = args[0].toLowerCase();

  if (arg === 'install') {
    installCompletions();
    return;
  }

  if (['bash', 'zsh', 'fish'].includes(arg)) {
    console.log(generateCompletion(arg));
    return;
  }

  console.log(error(`Unknown argument: ${args[0]}`));
  console.log(`    Use: bash, zsh, fish, or install`);
  process.exit(1);
}
