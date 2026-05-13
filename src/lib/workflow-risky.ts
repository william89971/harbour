/**
 * Tiny keyword-based "risky action" detector used to set sensible defaults
 * when authoring workflow steps. The user can always override the
 * resulting checkbox; the server doesn't block creation.
 *
 * Whole-word, case-insensitive matching so "deletion" doesn't trigger on
 * "delete" but "delete the records" does.
 */

export const RISKY_KEYWORDS: readonly string[] = [
  // Outbound communication
  "send email", "send sms", "send message",
  "post to slack", "post to twitter", "tweet",
  // Financial
  "spend", "charge", "transfer money", "pay", "wire",
  "cancel subscription", "refund",
  // Destructive
  "delete", "drop table", "rm -rf", "truncate",
  // Deployment / production
  "deploy", "git push", "merge to main", "merge to master", "production",
  // Customer-facing
  "contact customer", "reach out",
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if any keyword from RISKY_KEYWORDS appears as a whole match in
 *  the text. Phrase keywords (e.g. "send email") match literally; single
 *  words use a word-boundary regex so we don't fire on substrings. */
export function detectRiskyInstructions(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  for (const kw of RISKY_KEYWORDS) {
    if (kw.includes(" ")) {
      if (lower.includes(kw)) return true;
    } else {
      const re = new RegExp(`\\b${escapeRegex(kw)}\\b`, "i");
      if (re.test(text)) return true;
    }
  }
  return false;
}
