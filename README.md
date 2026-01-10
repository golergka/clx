# clx

CLI API Client Generator - Turn any OpenAPI spec into a command-line tool.

## Quick Start

```bash
# Install an API from the registry
clx install stripe

# Use it directly
stripe customers list --limit=10
stripe customers get cus_xxx --output=table
stripe customers create --email=user@example.com --name="John Doe"

# Configure authentication
stripe auth login
```

## Installation

### From Source (requires Bun)

```bash
git clone https://github.com/golergka/clx.git
cd clx
bun install
bun run build
```

### Binary Releases

Coming soon - see [Releases](https://github.com/golergka/clx/releases).

## Features

- **Zero code generation** - Parses OpenAPI specs at runtime
- **Busybox pattern** - Single binary, multiple symlinks (e.g., `stripe`, `github`)
- **Multi-auth support** - API keys, Bearer tokens, Basic auth, OAuth 2.0
- **Auth profiles** - Multiple credentials per API (`--profile prod`)
- **Agent-friendly** - Compact help, JSON output, semantic exit codes
- **Shell completions** - bash, zsh, fish

## Usage

### Package Management

```bash
# Search available APIs
clx search stripe

# Install from registry
clx install stripe

# Install from URL
clx install https://api.example.com/openapi.yaml --name myapi

# Install from local file
clx add ./spec.yaml --name myapi

# List installed APIs
clx list

# Update an API
clx update stripe

# Update all APIs
clx update --all

# Remove an API
clx remove stripe
```

### Authentication

```bash
# Configure auth (interactive)
stripe auth login

# Use named profiles
stripe auth login --profile prod
stripe auth switch prod
stripe auth list

# Check status
stripe auth status

# Logout
stripe auth logout
```

### Making Requests

```bash
# GET with query params
stripe customers list --limit=10 --starting_after=cus_xxx

# GET with path params
stripe customers get --customer=cus_xxx

# POST with body (from flags)
stripe customers create --email=user@example.com --name="John Doe"

# POST with body (from stdin)
echo '{"email": "user@example.com"}' | stripe customers create

# PUT/PATCH/DELETE
stripe customers update --customer=cus_xxx --name="Jane Doe"
stripe customers delete --customer=cus_xxx
```

### Output Formatting

```bash
# Default JSON output
stripe customers list

# Pretty-printed JSON (default)
stripe customers list --output=json

# Compact JSON
stripe customers list --compact

# Table format
stripe customers list --output=table

# Extract specific field
stripe customers get --customer=cus_xxx --field=email

# Combine with jq
stripe customers list | jq '.data[].email'
```

### Debugging

```bash
# Show curl equivalent (dry run)
stripe customers list --dry-run

# Verbose output (request/response details)
stripe customers list --verbose

# Diagnose setup issues
clx doctor
```

## Configuration

Configuration is stored in `~/.config/clx/` (or `$XDG_CONFIG_HOME/clx/`):

```
~/.config/clx/
├── specs/          # Downloaded OpenAPI specs
│   ├── stripe.yaml
│   └── github.yaml
└── auth/           # Auth credentials (mode 700)
    ├── stripe.json
    └── github.json
```

### Environment Variables

- `CLX_CONFIG_DIR` - Override config directory
- `CLX_BIN_DIR` - Override symlink directory (default: `/usr/local/bin`)

## Shell Completions

```bash
# Bash
eval "$(clx completion bash)"

# Zsh
eval "$(clx completion zsh)"

# Fish
clx completion fish | source
```

Add to your shell's rc file for persistence.

## Available APIs

```bash
clx search
```

Current registry includes:
- Stripe
- GitHub
- OpenAI
- Anthropic (unofficial spec)
- Slack
- Twilio
- Discord
- Petstore (demo)

## Error Handling

clx uses semantic exit codes:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Usage error (bad arguments) |
| 3 | Configuration error |
| 4 | Authentication error |
| 5 | Network error |
| 6 | API error (4xx/5xx) |
| 7 | Spec parsing error |
| 8 | I/O error |

## For AI Agents

clx is designed to be agent-friendly:

- Compact help output (< 50 tokens per command)
- Structured JSON responses
- Semantic exit codes for error handling
- `--dry-run` for safe exploration
- No interactive prompts in non-TTY mode
- Stdin piping for complex payloads

Example agent workflow:

```bash
# Explore the API
stripe --help
stripe customers --help
stripe customers create --help

# Test with dry-run
stripe customers create --email=test@example.com --dry-run

# Execute
stripe customers create --email=test@example.com
```

## Development

```bash
# Install dependencies
bun install

# Run in development
bun run src/index.ts --help
bun run src/index.ts stripe customers list

# Type check
bun run typecheck

# Build
bun run build
```

## License

MIT - see [LICENSE](LICENSE).
