// Update notification system
import * as fs from 'fs';
import * as path from 'path';
import { getConfigDir, shouldCheckUpdates } from './config.js';
import { box, yellow, cyan, dim } from './ui.js';

const VERSION = '0.1.2';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const UPDATE_CHECK_URL = 'https://registry.npmjs.org/clx-cli/latest';

interface UpdateCache {
  lastCheck: number;
  latestVersion: string | null;
}

function getCachePath(): string {
  return path.join(getConfigDir(), '.update-check');
}

function loadCache(): UpdateCache | null {
  try {
    const cachePath = getCachePath();
    if (!fs.existsSync(cachePath)) {
      return null;
    }
    const content = fs.readFileSync(cachePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function saveCache(cache: UpdateCache): void {
  try {
    const cachePath = getCachePath();
    fs.writeFileSync(cachePath, JSON.stringify(cache));
  } catch {
    // Ignore cache write errors
  }
}

// Check for updates (non-blocking, caches result)
export async function checkForUpdates(): Promise<void> {
  if (!shouldCheckUpdates()) {
    return;
  }

  const cache = loadCache();
  const now = Date.now();

  // Skip if we checked recently
  if (cache && now - cache.lastCheck < CHECK_INTERVAL_MS) {
    // Show notification if there's a cached update
    if (cache.latestVersion && isNewerVersion(cache.latestVersion, VERSION)) {
      showUpdateNotification(cache.latestVersion);
    }
    return;
  }

  // Check for updates in background (don't block)
  fetchLatestVersion().then(latestVersion => {
    const newCache: UpdateCache = {
      lastCheck: now,
      latestVersion,
    };
    saveCache(newCache);

    if (latestVersion && isNewerVersion(latestVersion, VERSION)) {
      showUpdateNotification(latestVersion);
    }
  }).catch(() => {
    // Ignore update check errors
  });
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(UPDATE_CHECK_URL, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { version?: string };
    return data.version || null;
  } catch {
    return null;
  }
}

// Compare semver versions
function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = latest.replace(/^v/, '').split('.').map(Number);
  const currentParts = current.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }

  return false;
}

function showUpdateNotification(latestVersion: string): void {
  console.log('');
  console.log(box([
    `Update available: ${dim(VERSION)} ${yellow('→')} ${cyan(latestVersion)}`,
    `Run '${cyan('npm update -g clx-cli')}' to update`,
  ]));
}

// Get current version
export function getVersion(): string {
  return VERSION;
}
