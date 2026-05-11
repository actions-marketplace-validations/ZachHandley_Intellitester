import { describe, expect, it } from 'vitest';

import { ResponseLog, RESPONSE_LOG_MAX_ENTRIES, type LoggedResponse } from '../src/executors/web/responseLog';

function makeEntry(over: Partial<LoggedResponse> = {}): LoggedResponse {
  return {
    url: 'https://x.com/api/foo',
    status: 200,
    headers: { 'content-type': 'application/json' },
    ts: Date.now(),
    ...over,
  };
}

describe('ResponseLog', () => {
  it('starts empty', () => {
    const log = new ResponseLog();
    expect(log.snapshot()).toEqual([]);
  });

  it('pushes entries in order', () => {
    const log = new ResponseLog();
    log.push(makeEntry({ url: 'a' }));
    log.push(makeEntry({ url: 'b' }));
    log.push(makeEntry({ url: 'c' }));
    expect(log.snapshot().map((e) => e.url)).toEqual(['a', 'b', 'c']);
  });

  it('drops oldest when capacity is exceeded', () => {
    const log = new ResponseLog(3);
    log.push(makeEntry({ url: 'a' }));
    log.push(makeEntry({ url: 'b' }));
    log.push(makeEntry({ url: 'c' }));
    log.push(makeEntry({ url: 'd' }));
    expect(log.snapshot().map((e) => e.url)).toEqual(['b', 'c', 'd']);
  });

  it('default cap is RESPONSE_LOG_MAX_ENTRIES', () => {
    const log = new ResponseLog();
    for (let i = 0; i < RESPONSE_LOG_MAX_ENTRIES + 5; i++) {
      log.push(makeEntry({ url: `u${i}` }));
    }
    const snap = log.snapshot();
    expect(snap.length).toBe(RESPONSE_LOG_MAX_ENTRIES);
    expect(snap[0].url).toBe('u5'); // first 5 were dropped
    expect(snap[snap.length - 1].url).toBe(`u${RESPONSE_LOG_MAX_ENTRIES + 4}`);
  });

  it('snapshot is a live view (reflects subsequent pushes)', () => {
    const log = new ResponseLog();
    const snap = log.snapshot();
    expect(snap.length).toBe(0);
    log.push(makeEntry({ url: 'a' }));
    expect(snap.length).toBe(1);
  });
});
