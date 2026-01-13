import fs from 'node:fs/promises';
import path from 'node:path';
import { executeCleanup } from '../core/cleanup/executor.js';
import { loadCleanupHandlers } from '../core/cleanup/loader.js';
import type { CleanupConfig, CleanupProvider } from '../core/cleanup/types.js';

const TRACK_DIR = '.intellitester/track';
const ACTIVE_TESTS_FILE = 'ACTIVE_TESTS.json';
const DEFAULT_STALE_MS = 2 * 60 * 60 * 1000; // 2 hours
const HEARTBEAT_MS = 15000;

interface ActiveTestEntry {
  sessionId: string;
  trackFile: string;
  startedAt: string;
  lastUpdated: string;
  cwd: string;
  providerConfig?: Record<string, unknown>;
}

interface ActiveTestsState {
  version: number;
  updatedAt: string;
  sessions: Record<string, ActiveTestEntry>;
}

interface FileTrackingOptions {
  sessionId: string;
  cwd?: string;
  trackDir?: string;
  providerConfig?: Record<string, unknown>;
  cleanupConfig?: CleanupConfig;
}

const getTrackDir = (cwd: string, trackDir?: string) =>
  trackDir ? path.resolve(cwd, trackDir) : path.join(cwd, TRACK_DIR);
const getActiveTestsPath = (cwd: string, trackDir?: string) =>
  path.join(getTrackDir(cwd, trackDir), ACTIVE_TESTS_FILE);

const loadActiveTests = async (cwd: string, trackDir?: string): Promise<ActiveTestsState> => {
  const filePath = getActiveTestsPath(cwd, trackDir);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as ActiveTestsState;
    if (!parsed.sessions || typeof parsed.sessions !== 'object') {
      throw new Error('Invalid ACTIVE_TESTS structure');
    }
    return parsed;
  } catch {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      sessions: {},
    };
  }
};

const saveActiveTests = async (cwd: string, state: ActiveTestsState, trackDir?: string): Promise<void> => {
  const filePath = getActiveTestsPath(cwd, trackDir);
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
};

const isStale = (entry: ActiveTestEntry, staleMs: number): boolean => {
  const last = new Date(entry.lastUpdated).getTime();
  if (Number.isNaN(last)) return true;
  return Date.now() - last > staleMs;
};

const readTrackedResources = async (trackFile: string): Promise<unknown[]> => {
  try {
    const content = await fs.readFile(trackFile, 'utf8');
    if (!content.trim()) return [];
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  } catch {
    return [];
  }
};

const cleanupStaleSession = async (
  entry: ActiveTestEntry,
  cleanupConfig?: CleanupConfig
): Promise<void> => {
  if (!entry.providerConfig || !cleanupConfig?.provider) return;

  const resources = await readTrackedResources(entry.trackFile);
  if (resources.length === 0) return;

  try {
    const { handlers, typeMappings, provider } = await loadCleanupHandlers(cleanupConfig, entry.cwd);
    if (!provider) return;

    await executeCleanup(resources as any, handlers, typeMappings, {
      parallel: cleanupConfig.parallel ?? false,
      retries: cleanupConfig.retries ?? 3,
      sessionId: entry.sessionId,
      testStartTime: entry.startedAt,
      providerConfig: entry.providerConfig as { provider: string; [key: string]: unknown },
      cwd: entry.cwd,
      config: { ...cleanupConfig, scanUntracked: false },
      provider: provider as CleanupProvider,
    });
  } catch {
    // Best-effort cleanup only
  }
};

const pruneStaleTests = async (cwd: string, cleanupConfig?: CleanupConfig, trackDir?: string): Promise<void> => {
  const state = await loadActiveTests(cwd, trackDir);
  const staleMs = Number(process.env.INTELLITESTER_STALE_TEST_MS ?? DEFAULT_STALE_MS);
  let changed = false;

  for (const [sessionId, entry] of Object.entries(state.sessions)) {
    let missingFile = false;
    try {
      await fs.access(entry.trackFile);
    } catch {
      missingFile = true;
    }

    if (!missingFile && !isStale(entry, staleMs)) continue;
    changed = true;

    await cleanupStaleSession(entry, cleanupConfig);
    try {
      await fs.rm(entry.trackFile, { force: true });
    } catch {
      // Ignore missing files
    }
    delete state.sessions[sessionId];
  }

  if (changed) {
    await saveActiveTests(cwd, state, trackDir);
  }
};

export async function initFileTracking(options: FileTrackingOptions): Promise<{
  trackFile: string;
  stop: () => Promise<void>;
}> {
  const cwd = options.cwd ?? process.cwd();
  const trackDir = options.trackDir;
  await fs.mkdir(getTrackDir(cwd, trackDir), { recursive: true });

  await pruneStaleTests(cwd, options.cleanupConfig, trackDir);

  const trackFile = path.join(getTrackDir(cwd, trackDir), `TEST_SESSION_${options.sessionId}.jsonl`);
  await fs.writeFile(trackFile, '', 'utf8');

  const state = await loadActiveTests(cwd, trackDir);
  state.sessions[options.sessionId] = {
    sessionId: options.sessionId,
    trackFile,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    cwd,
    providerConfig: options.providerConfig,
  };
  await saveActiveTests(cwd, state, trackDir);

  const touch = async () => {
    const current = await loadActiveTests(cwd, trackDir);
    const entry = current.sessions[options.sessionId];
    if (!entry) return;
    entry.lastUpdated = new Date().toISOString();
    current.sessions[options.sessionId] = entry;
    await saveActiveTests(cwd, current, trackDir);
  };

  const interval = setInterval(() => {
    void touch();
  }, HEARTBEAT_MS);

  const stop = async () => {
    clearInterval(interval);
    const current = await loadActiveTests(cwd, trackDir);
    delete current.sessions[options.sessionId];
    await saveActiveTests(cwd, current, trackDir);
    try {
      await fs.rm(trackFile, { force: true });
    } catch {
      // Ignore missing file
    }
  };

  return { trackFile, stop };
}

export async function mergeFileTrackedResources(
  trackFile: string,
  target: { resources: Array<Record<string, unknown>>; userId?: string; userEmail?: string },
  allowedTypes?: Set<string>
): Promise<void> {
  const entries = await readTrackedResources(trackFile);
  for (const entry of entries) {
    const resource = entry as Record<string, unknown>;
    if (!resource.type || !resource.id) continue;
    if (allowedTypes && !allowedTypes.has(String(resource.type))) continue;
    const exists = target.resources.some(
      (existing) => existing.type === resource.type && existing.id === resource.id
    );
    if (!exists) {
      target.resources.push(resource);
    }
    if (resource.type === 'user') {
      if (!target.userId && typeof resource.id === 'string') {
        target.userId = resource.id;
      }
      const email = resource.email;
      if (!target.userEmail && typeof email === 'string') {
        target.userEmail = email;
      }
    }
  }
}
