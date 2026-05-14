import { NextResponse } from "next/server";
import { withOperator } from "@/lib/auth";
import { getGmailConfigAsync, testGmailConnection } from "@/lib/gmail";

/** POST /api/integrations/gmail/test — verifies OAuth credentials by
 *  exchanging the refresh token for an access token. No data is sent. */
export const POST = withOperator(async () => {
  const cfg = await getGmailConfigAsync();
  const result = await testGmailConnection(cfg);
  return NextResponse.json(result);
});
