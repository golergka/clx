#!/usr/bin/env bun
// Script to update OpenAPI specs from their sources
// Usage: bun scripts/update-spec.ts <api-name>
//        bun scripts/update-spec.ts --all
//        bun scripts/update-spec.ts --check

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import YAML from 'yaml';

const SPECS_DIR = path.join(import.meta.dir, '..', 'src', 'specs');

interface SourceManifest {
  name: string;
  source: {
    type: 'url' | 'github';
    url?: string;
    repo?: string;
    path?: string;
    ref?: string;
  };
  retrieved: string | null;
  sha256: string | null;
  size: number | null;
}

function loadSourceManifest(specDir: string): SourceManifest | null {
  const manifestPath = path.join(specDir, '.source.yaml');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  const content = fs.readFileSync(manifestPath, 'utf-8');
  return YAML.parse(content) as SourceManifest;
}

function saveSourceManifest(specDir: string, manifest: SourceManifest): void {
  const manifestPath = path.join(specDir, '.source.yaml');
  fs.writeFileSync(manifestPath, YAML.stringify(manifest));
}

function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function fetchSpec(manifest: SourceManifest): Promise<string> {
  let url: string;

  if (manifest.source.type === 'url') {
    url = manifest.source.url!;
  } else if (manifest.source.type === 'github') {
    const { repo, path: filePath, ref } = manifest.source;
    url = `https://raw.githubusercontent.com/${repo}/${ref || 'main'}/${filePath}`;
  } else {
    throw new Error(`Unknown source type: ${manifest.source.type}`);
  }

  console.log(`  Fetching ${url}...`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function updateSpec(name: string, checkOnly: boolean = false): Promise<boolean> {
  const specDir = path.join(SPECS_DIR, name);

  if (!fs.existsSync(specDir)) {
    console.error(`  Error: Spec directory not found: ${specDir}`);
    return false;
  }

  const manifest = loadSourceManifest(specDir);
  if (!manifest) {
    console.error(`  Error: No .source.yaml found for ${name}`);
    return false;
  }

  console.log(`\n${name}:`);

  try {
    const content = await fetchSpec(manifest);
    const hash = computeHash(content);

    if (hash === manifest.sha256) {
      console.log(`  ✓ Up to date`);
      return true;
    }

    if (checkOnly) {
      console.log(`  ⚠ Update available (hash changed)`);
      return false;
    }

    // Write the spec file
    const specPath = path.join(specDir, 'openapi.yaml');
    fs.writeFileSync(specPath, content);

    // Update manifest
    manifest.retrieved = new Date().toISOString();
    manifest.sha256 = hash;
    manifest.size = content.length;
    saveSourceManifest(specDir, manifest);

    console.log(`  ✓ Updated (${(content.length / 1024).toFixed(1)} KB)`);
    return true;
  } catch (err) {
    console.error(`  ✗ Error: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

function listSpecs(): string[] {
  if (!fs.existsSync(SPECS_DIR)) {
    return [];
  }

  return fs.readdirSync(SPECS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`Usage: bun scripts/update-spec.ts <api-name>
       bun scripts/update-spec.ts --all
       bun scripts/update-spec.ts --check

Available specs: ${listSpecs().join(', ')}`);
    process.exit(1);
  }

  const checkOnly = args.includes('--check');
  const updateAll = args.includes('--all');

  if (updateAll || checkOnly) {
    const specs = listSpecs();
    if (specs.length === 0) {
      console.log('No specs found.');
      process.exit(0);
    }

    console.log(`${checkOnly ? 'Checking' : 'Updating'} ${specs.length} spec(s)...`);

    let success = 0;
    let failed = 0;

    for (const spec of specs) {
      const ok = await updateSpec(spec, checkOnly);
      if (ok) success++;
      else failed++;
    }

    console.log(`\nDone: ${success} ok, ${failed} ${checkOnly ? 'need update' : 'failed'}`);
    process.exit(failed > 0 ? 1 : 0);
  }

  // Single spec
  const specName = args.find(a => !a.startsWith('--'));
  if (!specName) {
    console.error('Error: No spec name provided');
    process.exit(1);
  }

  const ok = await updateSpec(specName, checkOnly);
  process.exit(ok ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
