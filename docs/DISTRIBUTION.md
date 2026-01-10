# Clx Distribution Setup

## Goal

Get `clx` installable via:
```bash
npm install -g clx      # Phase 1 (now)
brew install clx        # Phase 2 (later)
```

---

## Phase 1: npm Distribution

### Why npm First
- 5 minutes to publish vs hours for Homebrew
- Works on macOS, Linux, Windows
- No separate tap repo needed
- Can publish pre-compiled binaries via npm

### Setup Steps

#### 1. Create npm Account
```bash
# If you don't have one
npm adduser

# Or login
npm login
```

#### 2. Check Package Name Availability
```bash
npm view clx
# If taken, try: clx-cli, clxapi, etc.
```

#### 3. Configure package.json
```json
{
  "name": "clx",
  "version": "0.1.0",
  "description": "CLI API client generator from OpenAPI specs",
  "license": "AGPL-3.0-only",
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_USERNAME/clx.git"
  },
  "author": "Max",
  "bin": {
    "clx": "./dist/clx"
  },
  "files": [
    "dist/",
    "LICENSE",
    "README.md"
  ],
  "keywords": [
    "cli",
    "openapi",
    "swagger",
    "api",
    "rest",
    "codegen"
  ],
  "engines": {
    "node": ">=18"
  }
}
```

#### 4. Build Binary
```bash
bun build ./src/index.ts --compile --outfile dist/clx
```

#### 5. Test Locally
```bash
npm link
clx --help
```

#### 6. Publish
```bash
npm publish
```

#### 7. Verify
```bash
npm install -g clx
clx --version
```

---

## Phase 1b: Multi-Platform Binaries (Optional Enhancement)

If you want pre-built binaries for each platform:

```json
{
  "optionalDependencies": {
    "@clx/darwin-arm64": "0.1.0",
    "@clx/darwin-x64": "0.1.0",
    "@clx/linux-x64": "0.1.0",
    "@clx/win32-x64": "0.1.0"
  }
}
```

This is how esbuild/swc do it. More complex, skip for v1.

---

## Phase 2: Homebrew (Later)

### Why Homebrew
- Native macOS/Linux experience
- Single binary, no Node required
- More "professional" distribution

### Setup Steps

#### 1. Create GitHub Repo for Tap
```
https://github.com/YOUR_USERNAME/homebrew-clx
```

#### 2. Create Formula
File: `Formula/clx.rb`
```ruby
class Clx < Formula
  desc "CLI API client generator from OpenAPI specs"
  homepage "https://github.com/YOUR_USERNAME/clx"
  version "0.1.0"
  license "AGPL-3.0-only"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/YOUR_USERNAME/clx/releases/download/v0.1.0/clx-darwin-arm64.tar.gz"
      sha256 "REPLACE_WITH_ACTUAL_SHA256"
    else
      url "https://github.com/YOUR_USERNAME/clx/releases/download/v0.1.0/clx-darwin-x64.tar.gz"
      sha256 "REPLACE_WITH_ACTUAL_SHA256"
    end
  end

  on_linux do
    url "https://github.com/YOUR_USERNAME/clx/releases/download/v0.1.0/clx-linux-x64.tar.gz"
    sha256 "REPLACE_WITH_ACTUAL_SHA256"
  end

  def install
    bin.install "clx"
  end

  test do
    system "#{bin}/clx", "--version"
  end
end
```

#### 3. Build Release Binaries
```bash
# macOS ARM
bun build ./src/index.ts --compile --target=bun-darwin-arm64 --outfile clx-darwin-arm64
tar -czvf clx-darwin-arm64.tar.gz clx-darwin-arm64

# macOS Intel
bun build ./src/index.ts --compile --target=bun-darwin-x64 --outfile clx-darwin-x64
tar -czvf clx-darwin-x64.tar.gz clx-darwin-x64

# Linux
bun build ./src/index.ts --compile --target=bun-linux-x64 --outfile clx-linux-x64
tar -czvf clx-linux-x64.tar.gz clx-linux-x64
```

#### 4. Create GitHub Release
Upload all `.tar.gz` files to GitHub release v0.1.0

#### 5. Get SHA256
```bash
shasum -a 256 clx-darwin-arm64.tar.gz
```
Update formula with actual hashes.

#### 6. Users Install Via
```bash
brew tap YOUR_USERNAME/clx
brew install clx
```

---

## GitHub Repo Setup

### 1. Create Repo
```
https://github.com/YOUR_USERNAME/clx
```

### 2. Recommended Structure
```
clx/
├── src/
│   └── index.ts
├── specs/              # Bundled OpenAPI specs for registry
├── dist/               # Built binaries (gitignored)
├── package.json
├── tsconfig.json
├── LICENSE             # AGPL-3.0 text
├── README.md
└── .github/
    └── workflows/
        └── release.yml # CI for building + publishing
```

### 3. GitHub Actions for Release (Optional)
File: `.github/workflows/release.yml`
```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest
            target: bun-darwin-arm64
            artifact: clx-darwin-arm64
          - os: macos-13
            target: bun-darwin-x64
            artifact: clx-darwin-x64
          - os: ubuntu-latest
            target: bun-linux-x64
            artifact: clx-linux-x64

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      
      - run: bun install
      - run: bun build ./src/index.ts --compile --target=${{ matrix.target }} --outfile ${{ matrix.artifact }}
      
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact }}
          path: ${{ matrix.artifact }}

  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - uses: softprops/action-gh-release@v1
        with:
          files: |
            clx-darwin-arm64/clx-darwin-arm64
            clx-darwin-x64/clx-darwin-x64
            clx-linux-x64/clx-linux-x64

  npm:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          registry-url: 'https://registry.npmjs.org'
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## Checklist: What You Need

### Accounts
- [ ] GitHub account (you have this)
- [ ] npm account: https://www.npmjs.com/signup
- [ ] (Later) Homebrew doesn't need account, just a tap repo

### Repos
- [ ] `github.com/YOUR_USERNAME/clx` — main repo
- [ ] (Later) `github.com/YOUR_USERNAME/homebrew-clx` — Homebrew tap

### Secrets (for CI)
- [ ] `NPM_TOKEN` — from npm.com > Access Tokens > Generate

### Local Testing Before Publish
```bash
# Build
bun build ./src/index.ts --compile --outfile dist/clx

# Test binary directly
./dist/clx --help
./dist/clx install stripe
stripe --help

# Test npm package locally
npm link
clx --help

# Dry run publish (doesn't actually publish)
npm publish --dry-run
```

---

## Quick Start (Do This Now)

```bash
# 1. Create npm account if needed
npm adduser

# 2. Check name availability
npm view clx

# 3. From your clx project directory
npm link
clx --help

# 4. If it works, publish
npm publish

# 5. Test install
npm unlink clx
npm install -g clx
clx --version
```

Done. You're distributed.