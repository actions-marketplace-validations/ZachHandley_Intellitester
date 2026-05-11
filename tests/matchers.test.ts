import { describe, expect, it } from 'vitest';

import { compileMatcher } from '../src/executors/web/matchers';

describe('compileMatcher — url mode', () => {
  it('matches an exact URL', () => {
    const m = compileMatcher('https://x.com/api/logout', 'url');
    expect(m('https://x.com/api/logout')).toBe(true);
    expect(m('https://x.com/api/logout/extra')).toBe(false);
  });

  it('** matches any number of path segments', () => {
    const m = compileMatcher('**/api/logout', 'url');
    expect(m('https://x.com/api/logout')).toBe(true);
    expect(m('https://x.com/foo/bar/api/logout')).toBe(true);
    expect(m('https://x.com/api/login')).toBe(false);
  });

  it('* matches within a single segment only', () => {
    const m = compileMatcher('*/logout', 'url');
    expect(m('users/logout')).toBe(true);
    expect(m('foo/bar/logout')).toBe(false);
  });

  it('combined ** and * work together', () => {
    const m = compileMatcher('**/api/*/logout', 'url');
    expect(m('https://x.com/api/v1/logout')).toBe(true);
    expect(m('https://x.com/foo/api/v2/logout')).toBe(true);
    expect(m('https://x.com/api/v1/v2/logout')).toBe(false);
  });

  it('escapes regex metachars in literal portions', () => {
    const m = compileMatcher('https://x.com/api?foo=1', 'url');
    expect(m('https://x.com/api?foo=1')).toBe(true);
    expect(m('https://x.com/apiXfoo=1')).toBe(false); // `?` not treated as regex
  });

  it('/regex/ wrapper compiles to a JS RegExp', () => {
    const m = compileMatcher('/^https:.*\\/api\\/logout$/', 'url');
    expect(m('https://x.com/api/logout')).toBe(true);
    expect(m('http://x.com/api/logout')).toBe(false);
  });
});

describe('compileMatcher — substr mode', () => {
  it('matches a substring anywhere in the input', () => {
    const m = compileMatcher('Max-Age=0', 'substr');
    expect(m('zlayer_session=; Max-Age=0; Path=/')).toBe(true);
    expect(m('zlayer_session=abc; Max-Age=3600; Path=/')).toBe(false);
  });

  it('is case-sensitive by default', () => {
    const m = compileMatcher('max-age=0', 'substr');
    expect(m('zlayer_session=; Max-Age=0; Path=/')).toBe(false);
  });

  it('/regex/ wrapper overrides substring mode', () => {
    const m = compileMatcher('/Max-Age=\\d+/', 'substr');
    expect(m('zlayer_session=; Max-Age=0; Path=/')).toBe(true);
    expect(m('zlayer_session=; Path=/')).toBe(false);
  });
});
