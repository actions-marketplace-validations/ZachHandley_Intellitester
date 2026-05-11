import type { Page } from 'playwright';

/**
 * A single buffered response observation.
 * Header names are lower-cased on capture.
 */
export interface LoggedResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  ts: number;
}

/** Maximum entries kept in the ring buffer. Older entries are dropped first. */
export const RESPONSE_LOG_MAX_ENTRIES = 200;

/**
 * Bounded ring buffer of recent network responses for the page.
 * Used by the `expectResponse` action to look back at what fired since a marker timestamp.
 *
 * Public surface:
 * - `attach(page)`: subscribes to `page.on('response')`.
 * - `push(entry)`: append directly (used by unit tests).
 * - `snapshot()`: read-only view of current buffer contents (newest at the end).
 */
export class ResponseLog {
  private readonly buf: LoggedResponse[] = [];
  private readonly cap: number;

  constructor(cap: number = RESPONSE_LOG_MAX_ENTRIES) {
    this.cap = cap;
  }

  attach(page: Page): void {
    page.on('response', (res) => {
      void res
        .allHeaders()
        .then((headers) => {
          // Defensively lower-case header names.
          const lowered: Record<string, string> = {};
          for (const [k, v] of Object.entries(headers)) {
            lowered[k.toLowerCase()] = v;
          }
          this.push({
            url: res.url(),
            status: res.status(),
            headers: lowered,
            ts: Date.now(),
          });
        })
        .catch(() => {
          /* page may have closed mid-response; ignore */
        });
    });
  }

  push(entry: LoggedResponse): void {
    if (this.buf.length >= this.cap) this.buf.shift();
    this.buf.push(entry);
  }

  snapshot(): readonly LoggedResponse[] {
    return this.buf;
  }
}
