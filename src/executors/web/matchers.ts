/**
 * Compile a YAML-friendly pattern into a JS predicate.
 *
 * - Pattern wrapped in `/.../` → `RegExp.test` (the slashes are stripped before construction).
 * - Otherwise, depending on mode:
 *   - `'url'`: glob — `**` matches any number of segments (including `/`),
 *     `*` matches any chars except `/`. All other regex metachars are escaped.
 *     The compiled regex is anchored at both ends (`^...$`).
 *   - `'substr'`: plain substring (`String.includes`).
 *
 * Used by the `expectResponse` and `assertCookies` actions to match URL and
 * header/value patterns from YAML.
 */
export function compileMatcher(pattern: string, mode: 'url' | 'substr'): (s: string) => boolean {
  if (pattern.length >= 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
    const re = new RegExp(pattern.slice(1, -1));
    return (s) => re.test(s);
  }
  if (mode === 'url') {
    // Escape regex metachars EXCEPT * (we'll handle that next).
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    // ** → any chars (greedy), * → any non-slash chars. Use a sentinel to avoid double-replacement.
    const globbed = escaped
      .replace(/\*\*/g, ' ')
      .replace(/\*/g, '[^/]*')
      .replace(/ /g, '.*');
    const re = new RegExp(`^${globbed}$`);
    return (s) => re.test(s);
  }
  return (s) => s.includes(pattern);
}
