import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getGitHubSummaryAsync } from "@/lib/github";

/**
 * GET /api/integrations/github/summary
 *
 * Read-only summary of the configured repository. Returns
 * `{ configured: false, ... }` when settings/token aren't set up.
 * Errors on individual sub-fetches degrade gracefully into `errors[]`.
 *
 * Available to any authenticated caller (users + agents) because the
 * Product Review Loop's agent reads it during the gather phase. The
 * config-mutation endpoint remains operator-only.
 */
export const GET = withAuth(async () => {
  return NextResponse.json(await getGitHubSummaryAsync());
});
