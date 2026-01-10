# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-09

### Added
- Initial release of clx CLI API client generator
- OpenAPI 3.x spec parsing with YAML and JSON support
- Busybox-style symlink pattern for API commands
- Package management commands: install, remove, list, update, search, add
- Authentication support: API keys, Bearer tokens, Basic auth, OAuth 2.0
- Multiple auth profiles per API with `--profile` flag
- Automatic OAuth 2.0 token refresh
- Command tree navigation from OpenAPI paths
- Help generation at all levels (root, resource, operation)
- `--dry-run` mode for curl command generation
- `--verbose` mode for request/response details
- `--output=table` for human-readable table output
- `--field` extraction for JSON field selection
- `--compact` for minified JSON output
- Shell completions for bash, zsh, and fish
- `clx doctor` diagnostic command
- `clx update --all` to update all installed APIs
- Retry logic with exponential backoff for rate limits and server errors
- Semantic exit codes for different error types
- Structured error messages with hints
- Path traversal prevention for API names
- Token masking in verbose and dry-run output
- Registry with 8 popular APIs: Stripe, GitHub, OpenAI, Anthropic, Slack, Twilio, Discord, Petstore

### Security
- Auth credentials stored with restricted file permissions
- API tokens redacted in logs and curl output
- HTTPS enforced for spec downloads
- API name sanitization to prevent path traversal

### Known Issues
- OAuth 2.0 flow requires manual browser interaction
- Some registry API specs may be outdated (fetched from upstream)
