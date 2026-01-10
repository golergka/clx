# clx

Every API as a CLI. Built for AI agents.

## Quick Start

```bash
npm install -g clx-cli
clx install stripe
stripe auth login
stripe customers list
```

## Why

AI agents already know CLIs. They read `--help`, figure out the flags, and get things done. MCPs add protocol overhead and custom tooling for something curl already solved. clx gives your agent every API as a native command — auth, pagination, and errors handled automatically.

## Usage

```bash
# List Stripe customers
stripe customers list --limit=10

# Create a customer
stripe customers create --email=user@example.com

# Get help at any level
stripe --help
stripe customers --help
stripe customers create --help

# JSON output for piping
stripe customers list | jq '.data[].email'

# Dry-run shows the curl command
stripe customers list --dry-run
```

## APIs

Stripe, GitHub, Petstore (demo).

Missing one? [Open an issue](https://github.com/golergka/clx/issues).

## License

AGPL-3.0
