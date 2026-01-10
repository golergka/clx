# Clx: CLI API Client Generator

## PRD v0.1 | January 2026

---

## Executive Summary

Clx is a CLI tool that creates ergonomic command-line interfaces from OpenAPI specifications. Unlike existing solutions that generate source code, Clx interprets specs at runtime—no compilation step required.

The tool functions as a package manager for API CLIs: `clx install stripe` downloads the Stripe OpenAPI spec and makes `stripe` available as a global command. Primary users are AI coding agents (Claude Code, Cursor, etc.) that need efficient, self-documenting API access.

---

## Problem

### Current options suck for agents

| Approach | Problem |
|----------|---------|
| **MCPs** | Server setup, protocol overhead, configuration friction |
| **curl** | Verbose, no --help, auth on every request, eats tokens |
| **Generated SDKs** | Heavy, require build steps, language-specific |
| **Existing CLI generators** | Still require code generation + compilation per API |

### What agents need

- Self-documenting commands (`--help` at every level)
- Auth handled once, reused automatically
- Minimal token footprint
- JSON output for piping to jq
- Dry-run mode to preview requests

---

## Solution

### Core concept

One binary that interprets OpenAPI specs at runtime. When you run `stripe customers list`, Clx:

1. Checks `argv[0]` = "stripe"
2. Loads `~/.config/clx/specs/stripe.yaml`
3. Parses command against spec to find `GET /v1/customers`
4. Reads auth from `~/.config/clx/auth/stripe.json`
5. Executes request, returns JSON to stdout

### Prior art & differentiation

**danielgtaylor/openapi-cli-generator** is the closest existing tool. It generates Go code from OpenAPI specs, which you then compile. 

Clx differs:
- **No code generation** — specs are interpreted at runtime
- **Package manager model** — install/update/remove APIs like packages
- **Busybox pattern** — one binary, multiple symlinks
- **Agent-first** — optimized for AI coding tools, not humans

---

## Architecture

```
~/.config/clx/
├── specs/          # Downloaded OpenAPI specs
│   ├── stripe.yaml
│   └── github.yaml
├── auth/           # Credentials per API
│   ├── stripe.json
│   └── github.json
└── config.toml     # Global settings
```

### Installation flow

```bash
clx install stripe
# 1. Downloads spec from registry to ~/.config/clx/specs/stripe.yaml
# 2. Creates symlink: /usr/local/bin/stripe -> /usr/local/bin/clx
# 3. Done. "stripe" command now available.
```

### The Busybox pattern

Every installed API is a symlink pointing to the same `clx` binary. At runtime, Clx checks `argv[0]` to determine which spec to load.

```
/usr/local/bin/stripe  ->  /usr/local/bin/clx
/usr/local/bin/github  ->  /usr/local/bin/clx
/usr/local/bin/linear  ->  /usr/local/bin/clx
```

---

## CLI UX

### Command structure

Commands are resource-based, derived from OpenAPI paths:

```bash
stripe --help                     # List resource groups
stripe customers                  # Show operations on customers
stripe customers list --help      # Show params for list
stripe customers list --limit=10  # Execute
```

### Help output (agent-optimized)

```
$ stripe customers --help

Stripe Customers API

Commands:
  list      List all customers
  get       Retrieve a customer by ID
  create    Create a new customer
  update    Update a customer
  delete    Delete a customer

Run 'stripe customers <command> --help' for details.
```

### Input methods

```bash
# Inline flags
stripe customers create --email=x@y.com --name="Max"

# Stdin JSON
echo '{"email":"x@y.com"}' | stripe customers create
```

### Output

- **stdout**: JSON (pipe to jq)
- **stderr**: Errors with descriptive messages
- **Exit codes**: 0 success, non-zero failure
- **--dry-run**: Print curl equivalent without executing

---

## Authentication

### Design principle

Follow the original API's auth method. No abstraction layer.

### Supported patterns

- API keys (header or query param)
- Bearer tokens
- OAuth 2.0 with automatic refresh
- Basic auth

### Commands

```bash
stripe auth login     # Interactive setup, stores in ~/.config/clx/auth/stripe.json
stripe auth status    # Check current auth state
stripe auth logout    # Clear credentials
```

---

## Package Management

### Commands

```bash
clx search stripe     # Search registry
clx install stripe    # Download spec, create symlink
clx update stripe     # Fetch latest spec version
clx list              # Show installed CLIs
clx remove stripe     # Remove spec and symlink
```

### Private/custom specs

```bash
clx add ./my-api.yaml --name myapi
myapi endpoints list
```

### Versioning & resilience

Specs are vendored locally. If Stripe deprecates their API or a company shuts down, your local spec keeps working. The registry maintains versioned snapshots.

---

## Technical Implementation

### Stack

- **Language**: TypeScript
- **Compilation**: Bun compile or Deno compile → single binary
- **Distribution**: Homebrew (macOS/Linux)

### Config location

XDG standard: `~/.config/clx/`

### Pagination

Follow original API's pagination model (cursor, offset, Link headers). No magic `--all` flag—too dangerous for agents hitting large datasets. Use `--limit` to cap results.

---

## MVP Scope

### Phase 1: Core runtime

1. Parse a single OpenAPI spec (Stripe)
2. Handle API key auth
3. Execute GET/POST/PUT/DELETE requests
4. Generate `--help` at each command level
5. `--dry-run` mode
6. JSON output to stdout, errors to stderr

### Phase 2: Package manager

1. `clx install/remove/list/update`
2. Public registry with ~10 popular APIs
3. Symlink management

### Phase 3: Auth expansion

1. OAuth 2.0 flow with token refresh
2. Multiple auth profiles per API

---

## Business Model

### Open-core

| Tier | Included |
|------|----------|
| **Free** | Runtime + public registry (Stripe, GitHub, OpenAI, etc.) |
| **Pro** | Private spec support for internal APIs |
| **Team** | Hosted private registry, SSO, audit logs |

### Alternative: Usage-based

If agents become the dominant user, charge per API call through Clx. More complex to implement.

---

## Success Metrics

- Time to first API call < 60 seconds
- `--help` output under 50 tokens
- Support for 20+ public APIs in registry within 6 months
- Adoption by at least one major AI coding tool

---

## Open Questions

1. **Naming**: Clx? Apix? Something else that's not taken?
2. **Spec format**: OpenAPI 3.x only, or also support 2.0 (Swagger)?
3. **Windows support**: Priority or later?
4. **Rate limiting**: Should Clx handle retry-after headers automatically?

---

## Appendix: Competitive Landscape

| Tool | Type | Requires codegen? | Package manager? |
|------|------|-------------------|------------------|
| danielgtaylor/openapi-cli-generator | Go | Yes | No |
| OpenAPI Generator | Java | Yes | No |
| nirabo/openapi-cli-generator | Python | Yes | No |
| **Clx** | TypeScript | **No** | **Yes** |