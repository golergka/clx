# clx README Spec

## Core Message

**CLI beats MCP.** 

MCPs are overengineered. Agents already know how to use CLIs. Give them `--help` and they figure it out. No protocol overhead, no server setup, no custom tooling.

## Tone

- Confident, not arrogant
- Direct, not salesy
- Technical, not corporate
- Slightly opinionated, not preachy

**Yes:** "APIs at your fingertips"
**No:** "Revolutionary AI-powered API orchestration platform"

## Structure

```
# clx

One-liner that explains what it does.

## Quick Start (4 commands max)

npm install
clx install stripe  
clx auth login stripe
stripe customers list

## Why

2-3 sentences on CLI > MCP. No bullet points.

## Usage

Minimal examples. Let --help do the work.

## Available APIs

Simple list or link to list.

## License

AGPL-3.0
```

## Section Details

### Headline + One-liner

Short. Memorable. Says what it does.

```markdown
# clx

API calls from the command line. Built for AI agents.
```

Or:

```markdown
# clx

Every API as a CLI.
```

Not:

```markdown
# clx

A powerful, extensible command-line interface framework for seamlessly 
interacting with RESTful APIs through OpenAPI specifications, optimized 
for AI agent workflows and developer productivity.
```

### Quick Start

Four commands. Zero explanation needed.

```markdown
## Quick Start

npm install -g clx
clx install stripe
clx auth login stripe
stripe customers list
```

That's it. Reader should be able to copy-paste and see value in 60 seconds.

### Why clx

One short paragraph. State the opinion, don't oversell it.

```markdown
## Why

AI agents already know how to use CLIs. They read `--help`, figure out 
the flags, and get things done. MCPs add protocol overhead, server setup, 
and custom tooling for something curl already solved. clx gives your agent 
every API as a native command — with auth, pagination, and structured 
output handled automatically.
```

Not:

```markdown
## Why clx is the Future of AI-API Integration

In today's rapidly evolving AI landscape, seamless API integration has 
become a critical bottleneck. Traditional approaches like MCPs introduce 
unnecessary complexity... [500 more words]
```

### Usage

Show, don't tell. Examples over explanations.

```markdown
## Usage

# List Stripe customers
stripe customers list --limit 10

# Create a customer
stripe customers create --email user@example.com

# Get help at any level
stripe --help
stripe customers --help
stripe customers create --help

# JSON output for piping
stripe customers list --json | jq '.data[].email'
```

### What's Included

Simple list. Link to full list if it's long.

```markdown
## APIs

Stripe, GitHub, OpenAI, Anthropic, Linear, Slack, Twilio, Discord, Notion, 
and [X more](./docs/apis.md).

Missing one? [Add it](./CONTRIBUTING.md).
```

### License

One line.

```markdown
## License

AGPL-3.0
```

## What NOT to Include

- Badges (build status, coverage, etc.) — add later when they mean something
- Long feature lists
- Comparison tables
- Screenshots (it's a CLI)
- "Installation" as a separate section (it's one command)
- Contributor list (put in CONTRIBUTORS.md)
- Changelog (put in CHANGELOG.md)
- Detailed API documentation (put in /docs)

## Length Target

Entire README should fit in one screen without scrolling (~40 lines).

## Example Complete README

```markdown
# clx

Every API as a CLI. Built for AI agents.

## Quick Start

npm install -g clx
clx install stripe
clx auth login stripe
stripe customers list

## Why

AI agents already know CLIs. They read `--help`, figure out the flags, 
and get things done. MCPs add protocol overhead and custom tooling for 
something curl already solved. clx gives your agent every API as a 
native command — auth, pagination, and errors handled automatically.

## Usage

stripe customers list --limit 10
stripe customers create --email user@example.com
github repos list --mine
openai chat completions create --model gpt-4 --message "hi"

# Help at every level
stripe --help
stripe customers --help
stripe customers create --help

## APIs

Stripe, GitHub, OpenAI, Anthropic, Linear, Slack, Twilio, Discord, 
Notion, and [50 more](./docs/apis.md).

## License

AGPL-3.0
```

That's ~30 lines. Reader knows exactly what this is and how to use it.