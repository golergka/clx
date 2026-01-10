// Shell completion scripts for bash, zsh, and fish

import { listInstalledSpecs, loadSpec } from './config.js';
import { buildCommandTree } from './parser.js';

// Generate bash completion script
export function generateBashCompletion(): string {
  return `# clx bash completion
# Add to ~/.bashrc: eval "$(clx completion bash)"

_clx_completions() {
    local cur prev words cword
    _init_completion || return

    local commands="install remove list update search add help version doctor completion"
    local apis=$(clx list 2>/dev/null | tail -n +3 | awk '{print $1}')

    case $cword in
        1)
            COMPREPLY=($(compgen -W "$commands $apis" -- "$cur"))
            ;;
        2)
            case "$prev" in
                install|update|remove)
                    # Complete with available or installed APIs
                    if [[ "$prev" == "install" ]]; then
                        local available=$(clx search 2>/dev/null | tail -n +3 | awk '{print $1}')
                        COMPREPLY=($(compgen -W "$available" -- "$cur"))
                    else
                        COMPREPLY=($(compgen -W "$apis" -- "$cur"))
                    fi
                    ;;
                add)
                    # Complete with files
                    _filedir '@(yaml|yml|json)'
                    ;;
                completion)
                    COMPREPLY=($(compgen -W "bash zsh fish" -- "$cur"))
                    ;;
                *)
                    # If prev is an API name, complete with subcommands
                    if echo "$apis" | grep -qw "$prev"; then
                        local subcommands=$(_clx_get_subcommands "$prev" "")
                        COMPREPLY=($(compgen -W "$subcommands" -- "$cur"))
                    fi
                    ;;
            esac
            ;;
        *)
            # Deep completion for API commands
            local api_index=-1
            for ((i=1; i<cword; i++)); do
                if echo "$apis" | grep -qw "\${words[$i]}"; then
                    api_index=$i
                    break
                fi
            done

            if [[ $api_index -gt 0 ]]; then
                local api="\${words[$api_index]}"
                local path="\${words[@]:$((api_index+1)):$((cword-api_index-1))}"
                local subcommands=$(_clx_get_subcommands "$api" "$path")
                COMPREPLY=($(compgen -W "$subcommands" -- "$cur"))
            fi
            ;;
    esac
}

_clx_get_subcommands() {
    local api=$1
    local path=$2
    # This would need to parse the spec, for now return common commands
    echo "auth list get create update delete --help --dry-run --verbose"
}

complete -F _clx_completions clx

# Also complete for installed API commands
for api in $(clx list 2>/dev/null | tail -n +3 | awk '{print $1}'); do
    complete -F _clx_completions "$api"
done
`;
}

// Generate zsh completion script
export function generateZshCompletion(): string {
  return `#compdef clx
# clx zsh completion
# Add to ~/.zshrc: eval "$(clx completion zsh)"

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
        'completion:Generate shell completion'
        'help:Show help'
        'version:Show version'
    )

    apis=($(clx list 2>/dev/null | tail -n +3 | awk '{print $1}'))

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
                    available=($(clx search 2>/dev/null | tail -n +3 | awk '{print $1}'))
                    _describe -t apis 'available APIs' available
                    ;;
                remove|update)
                    _describe -t apis 'installed APIs' apis
                    ;;
                add)
                    _files -g '*.{yaml,yml,json}'
                    ;;
                completion)
                    _values 'shell' bash zsh fish
                    ;;
                *)
                    if (( \${apis[(I)$words[1]]} )); then
                        # API subcommands
                        _clx_api_commands
                    fi
                    ;;
            esac
            ;;
    esac
}

_clx_api_commands() {
    local -a subcommands
    subcommands=(
        'auth:Manage authentication'
        '--help:Show help'
        '--dry-run:Show curl command without executing'
        '--verbose:Show request/response details'
        '--profile:Use specific auth profile'
    )
    _describe -t commands 'API command' subcommands
}

compdef _clx clx

# Also complete for installed API commands
for api in $(clx list 2>/dev/null | tail -n +3 | awk '{print $1}'); do
    compdef _clx "$api"
done
`;
}

// Generate fish completion script
export function generateFishCompletion(): string {
  return `# clx fish completion
# Add to ~/.config/fish/completions/clx.fish or run: clx completion fish | source

# Disable file completion by default
complete -c clx -f

# Main commands
complete -c clx -n '__fish_use_subcommand' -a 'install' -d 'Install an API from registry'
complete -c clx -n '__fish_use_subcommand' -a 'remove' -d 'Remove an installed API'
complete -c clx -n '__fish_use_subcommand' -a 'list' -d 'List installed APIs'
complete -c clx -n '__fish_use_subcommand' -a 'update' -d 'Update an API'
complete -c clx -n '__fish_use_subcommand' -a 'search' -d 'Search available APIs'
complete -c clx -n '__fish_use_subcommand' -a 'add' -d 'Add a local OpenAPI spec'
complete -c clx -n '__fish_use_subcommand' -a 'doctor' -d 'Run diagnostic checks'
complete -c clx -n '__fish_use_subcommand' -a 'completion' -d 'Generate shell completion'
complete -c clx -n '__fish_use_subcommand' -a 'help' -d 'Show help'
complete -c clx -n '__fish_use_subcommand' -a 'version' -d 'Show version'

# Install completions (available APIs)
complete -c clx -n '__fish_seen_subcommand_from install' -a '(clx search 2>/dev/null | tail -n +3 | awk \\'{print $1}\\')'

# Remove/update completions (installed APIs)
complete -c clx -n '__fish_seen_subcommand_from remove update' -a '(clx list 2>/dev/null | tail -n +3 | awk \\'{print $1}\\')'

# Completion shell options
complete -c clx -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'

# Add installed APIs as subcommands
for api in (clx list 2>/dev/null | tail -n +3 | awk '{print $1}')
    complete -c clx -n '__fish_use_subcommand' -a "$api" -d "Use $api API"

    # API subcommands
    complete -c "$api" -f
    complete -c "$api" -n '__fish_use_subcommand' -a 'auth' -d 'Manage authentication'
    complete -c "$api" -l help -d 'Show help'
    complete -c "$api" -l dry-run -d 'Show curl command without executing'
    complete -c "$api" -l verbose -d 'Show request/response details'
    complete -c "$api" -l profile -d 'Use specific auth profile'
    complete -c "$api" -l output -a 'json table' -d 'Output format'
    complete -c "$api" -l field -d 'Extract specific field from response'
end
`;
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
