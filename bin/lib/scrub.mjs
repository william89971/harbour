/**
 * Best-effort secret scrubber for run activity logs.
 *
 * The runner injects decrypted env-var values into the agent subprocess so
 * shell scripts can expand `$VARNAME` naturally. If those values end up
 * echoed to stdout (intentionally or via a misbehaving curl logging the URL),
 * the raw secret would otherwise land in the activity log, visible to every
 * operator/viewer in the dashboard.
 *
 * This module replaces literal substring occurrences of each known value
 * with `[REDACTED]`. Values shorter than `minLen` (default 8) are skipped
 * because short strings are likely to be common substrings (e.g. "true",
 * "prod", a port number) and would over-mask legitimate output.
 *
 * It is best-effort: an agent can still hex-encode, base64, or split the
 * value across lines to defeat the scrubber. The defense-in-depth pieces
 * are (1) marking the agent unrestricted only deliberately, (2) RBAC on
 * env-var plaintexts (admin-only), (3) this scrubber for the common case.
 */

/**
 * @param {string} text - the output to scrub
 * @param {Record<string, string> | undefined | null} values - env vars (value side is scrubbed)
 * @param {{ minLen?: number, placeholder?: string }} [opts]
 * @returns {string}
 */
export function scrubSecrets(text, values, opts = {}) {
  if (!text || !values) return text || "";
  const minLen = opts.minLen ?? 8;
  const placeholder = opts.placeholder ?? "[REDACTED]";

  // Collect values, dedupe, sort by length DESC so longer values are masked
  // before shorter ones they might contain (otherwise the inner match leaves
  // a partial leak). e.g. mask "FULL_API_KEY_abc123" before "_abc123".
  const seen = new Set();
  const toMask = [];
  for (const v of Object.values(values)) {
    if (typeof v !== "string") continue;
    if (v.length < minLen) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    toMask.push(v);
  }
  toMask.sort((a, b) => b.length - a.length);

  let out = text;
  for (const v of toMask) {
    // String#replaceAll on plain string treats it literally — no regex
    // escaping concerns. Available since Node 15.
    out = out.split(v).join(placeholder);
  }
  return out;
}
