# clx User Experience Specification

## Directory Structure

```
~/.clx/
├── bin/
│   ├── clx                 # Main binary (or symlink to global install)
│   ├── stripe -> clx       # API shims
│   └── github -> clx
├── specs/
│   ├── stripe.yaml
│   └── github.yaml
├── auth/
│   └── stripe.json         # Mode 600
└── config.toml             # Optional global config
```

---

## Shell Integration

### `clx setup`

Interactive shell integration wizard. Run automatically on first `clx install` if PATH is not configured.

```
$ clx setup

  🔧 Shell Setup

  Detected shell: zsh
  Config file: ~/.zshrc

  ~/.clx/bin is not in your PATH.

  ? Add clx to your PATH? (Y/n) y

  ✓ Added to ~/.zshrc:
    export PATH="$HOME/.clx/bin:$PATH"

  Run this to apply now:
    source ~/.zshrc

  Or restart your terminal.
```

**Behavior:**

1. Detect shell from `$SHELL` (`bash`, `zsh`, `fish`)
2. Detect config file:
   - bash: `~/.bashrc` (or `~/.bash_profile` on macOS if bashrc doesn't exist)
   - zsh: `~/.zshrc`
   - fish: `~/.config/fish/config.fish`
3. Check if `~/.clx/bin` already in file (grep before appending)
4. Append appropriate line:
   - bash/zsh: `export PATH="$HOME/.clx/bin:$PATH"`
   - fish: `set -gx PATH $HOME/.clx/bin $PATH`
5. Verify write succeeded

**Flags:**

```
clx setup --shell zsh      # Force specific shell
clx setup --yes            # Non-interactive, just do it
clx setup --check          # Only check, don't modify (exit 0 if ok, 1 if not)
clx setup --uninstall      # Remove clx from shell config
```

### Automatic Prompt

When running `clx install <api>` and PATH is not set up:

```
$ clx install stripe

  ✓ Installed stripe

  ⚠ ~/.clx/bin is not in your PATH
  
  Run 'clx setup' to fix this, or add manually:
    export PATH="$HOME/.clx/bin:$PATH"
```

Don't block, don't force — just inform.

---

## `clx doctor`

Health check command. Diagnose common issues.

```
$ clx doctor

  clx doctor

  ✓ clx version 0.1.0
  ✓ Shell: zsh
  ✓ PATH includes ~/.clx/bin
  ✓ Config directory: ~/.clx (writable)
  ✓ 3 APIs installed (stripe, github, openai)
  ✓ 2 authenticated (stripe, github)
  ⚠ openai: not authenticated
  ✓ Network: registry.clx.dev reachable

  1 warning. Run 'clx auth login openai' to authenticate.
```

**Checks:**

| Check | Pass | Warn | Fail |
|-------|------|------|------|
| PATH setup | `~/.clx/bin` in PATH | Not in PATH | — |
| Config dir | Exists, writable | — | Not writable |
| Installed APIs | Lists count | — | — |
| Auth status | Per-API auth valid | Not authenticated | Auth file corrupted |
| Network | Registry reachable | Slow (>2s) | Unreachable |
| Spec validity | All specs parse | — | Spec parse errors |
| Symlinks | All valid | Orphaned symlinks | — |
| Disk space | — | <100MB free | <10MB free |

**Flags:**

```
clx doctor --json          # Machine-readable output
clx doctor --fix           # Auto-fix what's possible (remove orphaned symlinks, etc.)
```

---

## Colored Output

### Color Palette

Use ANSI colors consistently:

| Element | Color | ANSI Code |
|---------|-------|-----------|
| Success | Green | `\x1b[32m` |
| Warning | Yellow | `\x1b[33m` |
| Error | Red | `\x1b[31m` |
| Info/Heading | Bold | `\x1b[1m` |
| Dimmed/Secondary | Gray | `\x1b[90m` |
| Command/Code | Cyan | `\x1b[36m` |
| URL | Blue underline | `\x1b[34;4m` |

### Symbols

Use Unicode symbols (with ASCII fallbacks for dumb terminals):

| Meaning | Symbol | ASCII Fallback |
|---------|--------|----------------|
| Success | ✓ | [ok] |
| Warning | ⚠ | [!] |
| Error | ✗ | [x] |
| Info | ℹ | [i] |
| Arrow | → | -> |
| Spinner | ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ | \|/-\ |

### TTY Detection

```typescript
const isTTY = process.stdout.isTTY;
const useColor = isTTY && !process.env.NO_COLOR;
const useUnicode = isTTY && process.env.TERM !== 'dumb';
```

Respect `NO_COLOR` environment variable (https://no-color.org/).

### Examples

**Success:**
```
  ✓ Installed stripe
```

**Error:**
```
  ✗ Failed to install stripe
    Could not fetch spec from registry
    
    Try again or check your network connection.
```

**Progress:**
```
  ⠹ Fetching stripe spec...
```

**Dim secondary info:**
```
  ✓ Installed stripe
    └─ v2024.01.15 • 247 endpoints
```

---

## First-Run Experience

When user runs any command before setup:

```
$ stripe customers list

  Welcome to clx!

  Looks like this is your first time. Let's get set up.

  ? Add clx to your PATH? (Y/n) y

  ✓ Added to ~/.zshrc

  ? Install 'stripe' API? (Y/n) y

  ✓ Installed stripe

  Now authenticate:
    clx auth login stripe

  Then try again:
    stripe customers list
```

**Skip with:** `CLX_SKIP_SETUP=1` env var or `--no-setup` flag.

---

## Progress & Spinners

For operations >200ms, show a spinner:

```
  ⠹ Fetching spec...
  ⠹ Installing stripe...
```

Spinner clears on completion:

```
  ✓ Installed stripe (1.2s)
```

For multi-step operations:

```
  ⠹ Installing stripe (1/3) Fetching spec...
  ⠹ Installing stripe (2/3) Parsing spec...
  ⠹ Installing stripe (3/3) Creating symlink...
  ✓ Installed stripe (2.1s)
```

For network requests, show what's happening:

```
  ⠹ POST api.stripe.com/v1/customers...
```

---

## Error Messages

### Structure

Every error should have:

1. **What failed** (bold/red)
2. **Why it failed** (normal)
3. **How to fix** (actionable)

### Examples

**Network error:**
```
  ✗ Failed to install stripe
    
    Could not connect to registry.clx.dev
    Request timed out after 10s.

    Check your internet connection and try again.
    If the problem persists, check https://status.clx.dev
```

**Auth error:**
```
  ✗ Authentication failed
    
    Invalid API key for stripe.
    The key you provided was rejected by the API.

    Get a new key at: https://dashboard.stripe.com/apikeys
    Then run: clx auth login stripe
```

**Spec error:**
```
  ✗ Invalid OpenAPI spec
    
    Parse error in stripe.yaml at line 247:
    "Missing required field: operationId"

    This is a problem with the spec, not your command.
    Report at: https://github.com/clx-dev/registry/issues
```

**User error:**
```
  ✗ Unknown command: stripe customer list

    Did you mean?
      stripe customers list

    Run 'stripe --help' for available commands.
```

---

## Help System

### Levels

```
clx --help              # Top-level help
clx install --help      # Subcommand help  
stripe --help           # API-level help
stripe customers --help # Resource-level help
stripe customers list --help  # Operation-level help
```

### Format

Concise, scannable, agent-friendly:

```
$ stripe customers --help

stripe customers - Manage customers

Commands:
  list      List all customers
  create    Create a customer
  get       Retrieve a customer
  update    Update a customer
  delete    Delete a customer

Run 'stripe customers <command> --help' for details.
```

Operation-level — show params:

```
$ stripe customers list --help

stripe customers list - List all customers

Options:
  --limit <n>        Max results (1-100, default: 10)
  --email <email>    Filter by email
  --created[gte]     Created after (Unix timestamp)
  --created[lte]     Created before (Unix timestamp)
  --starting-after   Cursor for pagination

Examples:
  stripe customers list --limit 50
  stripe customers list --email user@example.com
```

### Token Efficiency

Help output should be <50 tokens for top-level, <100 for operation-level. Agents parse this.

---

## Confirmation Prompts

For destructive operations:

```
$ clx uninstall stripe

  This will remove:
    • stripe API and symlink
    • Saved authentication

  ? Are you sure? (y/N) y

  ✓ Uninstalled stripe
```

**Skip with:** `--yes` or `-y` flag.

```
$ clx uninstall stripe --yes
  ✓ Uninstalled stripe
```

For non-destructive but significant:

```
$ clx auth login stripe

  ? Enter your Stripe API key: sk_test_...

  ✓ Authenticated with stripe
    Key saved to ~/.clx/auth/stripe.json
```

---

## Autocomplete / Shell Completions

### `clx completions`

Generate shell completions:

```
$ clx completions zsh

# Add to ~/.zshrc:
eval "$(clx completions zsh)"
```

Or install directly:

```
$ clx completions install

  ✓ Installed zsh completions
    Restart your shell to enable.
```

### Dynamic Completions

Completions should be dynamic based on installed APIs:

```
$ clx <TAB>
install    uninstall    list    update    auth    doctor    setup

$ stripe <TAB>
customers    charges    invoices    subscriptions    ...

$ stripe customers <TAB>
list    create    get    update    delete
```

---

## Quiet & Verbose Modes

### `--quiet` / `-q`

Suppress all output except errors and final result:

```
$ clx install stripe -q
$ stripe customers list -q
{"data":[...]}
```

### `--verbose` / `-v`

Show detailed info for debugging:

```
$ stripe customers list -v

  → Loading spec from ~/.clx/specs/stripe.yaml
  → Parsed 247 operations
  → Auth: Bearer token from ~/.clx/auth/stripe.json
  → GET https://api.stripe.com/v1/customers
  → Headers: Authorization: Bearer sk_test_...
  ← 200 OK (247ms)
  ← Content-Type: application/json
  
  {"data":[...]}
```

**Security:** Redact sensitive values:

```
  → Headers: Authorization: Bearer sk_test_****
```

---

## JSON Output Mode

### `--json`

All commands support `--json` for machine consumption:

```
$ clx list --json
{"apis":[{"name":"stripe","version":"2024.01.15","authenticated":true}]}

$ clx doctor --json
{"checks":[{"name":"path","status":"pass"},{"name":"auth:stripe","status":"pass"}]}

$ stripe customers list --json
{"data":[...],"has_more":true}
```

Errors also JSON:

```
$ stripe customers get nonexistent --json
{"error":{"type":"not_found","message":"Customer not found"}}
```

---

## Update Notifications

On any command, if update available (check cached, max 1x/day):

```
$ stripe customers list
{"data":[...]}

  ┌────────────────────────────────────────┐
  │  Update available: 0.1.0 → 0.2.0       │
  │  Run 'clx upgrade' to update           │
  └────────────────────────────────────────┘
```

**Suppress with:** `CLX_NO_UPDATE_CHECK=1` or in config.

---

## Config File

Optional `~/.clx/config.toml`:

```toml
# Suppress update checks
update_check = false

# Default output format
output = "json"

# Disable color
color = false

# Custom registry (for enterprise)
registry = "https://registry.internal.company.com"

# Request timeout in seconds
timeout = 30

# Per-API config
[apis.stripe]
base_url = "https://api.stripe.com"  # Override
profile = "production"                # Which auth profile to use
```

---

## Exit Codes

Semantic exit codes for scripting:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Usage error (bad args) |
| 3 | Network error |
| 4 | Auth error (not authenticated, expired, rejected) |
| 5 | Not found (API, resource, command) |
| 6 | Spec error (invalid/unparseable spec) |
| 64-78 | Reserved for sysexits.h compatibility |

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `CLX_HOME` | Override config dir (default: `~/.clx`) |
| `CLX_BIN` | Override bin dir (default: `$CLX_HOME/bin`) |
| `CLX_REGISTRY` | Override registry URL |
| `CLX_NO_COLOR` | Disable colors (also respects `NO_COLOR`) |
| `CLX_NO_UPDATE_CHECK` | Disable update notifications |
| `CLX_SKIP_SETUP` | Skip first-run wizard |
| `CLX_DEBUG` | Enable debug logging |
| `STRIPE_API_KEY` | Per-API env var override (checked before auth file) |

---

## Implementation Notes

### Recommended Libraries (Node/Bun)

- **Colors:** `picocolors` (tiny, fast) or `chalk`
- **Prompts:** `@clack/prompts` (beautiful) or `enquirer`
- **Spinners:** `ora` or `nanospinner`
- **Args:** `commander` or `yargs` or hand-rolled for minimal deps
- **Completions:** `omelette` or `tabtab`

### Example: clx install with full UX

```typescript
import { intro, outro, confirm, spinner } from '@clack/prompts';
import pc from 'picocolors';

async function install(api: string) {
  // Check PATH first
  if (!isInPath()) {
    const shouldSetup = await confirm({
      message: `~/.clx/bin is not in your PATH. Run setup?`,
    });
    if (shouldSetup) await setup();
  }

  const s = spinner();
  s.start(`Installing ${api}`);

  try {
    await fetchSpec(api);
    await createSymlink(api);
    s.stop(pc.green(`✓ Installed ${api}`));
  } catch (err) {
    s.stop(pc.red(`✗ Failed to install ${api}`));
    console.error(pc.dim(`  ${err.message}`));
    process.exit(1);
  }
}
```