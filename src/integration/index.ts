/**
 * IntelliTester Integration - Track server-side resources for test cleanup
 *
 * Usage in app SSR code:
 *   import { track } from 'intellitester/integration';
 *
 *   // Track a database row
 *   await track({ type: 'row', id: row.$id, database: 'main', table: 'users' });
 *
 *   // Track a team
 *   await track({ type: 'team', id: team.$id });
 *
 *   // Track anything - it's just metadata for your cleanup handler
 *   await track({ type: 'stripe_customer', id: customerId });
 */

/**
 * Track a resource for cleanup after tests.
 * Provider-agnostic - just tracks type, id, and metadata.
 * Cleanup logic is handled by the configured provider.
 */
export interface TrackedResource {
  type: string;           // 'row', 'team', 'file', 'user', or any custom type
  id: string;             // Resource ID
  [key: string]: unknown; // Any additional metadata needed for cleanup
}

/**
 * Track a resource created in server-side code.
 * No-op if not in test mode.
 *
 * @example
 * // Track a database row
 * await track({ type: 'row', id: row.$id, database: 'main', table: 'users' });
 *
 * // Track a team
 * await track({ type: 'team', id: team.$id });
 *
 * // Track anything - it's just metadata for your cleanup handler
 * await track({ type: 'stripe_customer', id: customerId });
 */
type TrackingMode = 'none' | 'http' | 'file' | 'both';

let cachedTracking: {
  sessionId?: string;
  trackUrl?: string;
  trackFile?: string;
  mode: TrackingMode;
} | null = null;

const resolveTracking = (): {
  sessionId?: string;
  trackUrl?: string;
  trackFile?: string;
  mode: TrackingMode;
} => {
  const sessionId = process.env.INTELLITESTER_SESSION_ID;
  const trackUrl = process.env.INTELLITESTER_TRACK_URL;
  const trackFile = process.env.INTELLITESTER_TRACK_FILE;

  if (
    cachedTracking &&
    cachedTracking.sessionId === sessionId &&
    cachedTracking.trackUrl === trackUrl &&
    cachedTracking.trackFile === trackFile
  ) {
    return cachedTracking;
  }

  let mode: TrackingMode = 'none';
  if (trackUrl && trackFile) {
    mode = 'both';
  } else if (trackUrl) {
    mode = 'http';
  } else if (trackFile) {
    mode = 'file';
  }

  cachedTracking = { sessionId, trackUrl, trackFile, mode };
  return cachedTracking;
};

export async function track(resource: TrackedResource): Promise<void> {
  // Only run on server (SSR), not in browser
  if (typeof window !== 'undefined') return;
  if (typeof process === 'undefined') return;

  const { sessionId, trackUrl, trackFile, mode } = resolveTracking();

  if (!sessionId || mode === 'none') return;

  if (trackUrl && (mode === 'http' || mode === 'both')) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);
      await fetch(`${trackUrl}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, ...resource }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch {
      // Silent fail - don't break app
    }
  }

  if (trackFile && (mode === 'file' || mode === 'both')) {
    try {
      const { appendFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      if (!existsSync(trackFile)) return;
      const payload = {
        sessionId,
        createdAt: new Date().toISOString(),
        ...resource,
      };
      await appendFile(trackFile, `${JSON.stringify(payload)}\n`, 'utf8');
    } catch {
      // Silent fail - don't break app
    }
  }
}
