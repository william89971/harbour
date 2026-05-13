import { NextResponse } from "next/server";
import { withUserAdmin } from "@/lib/auth";
import { getDbAsync } from "@/lib/db/schema";
import { computeSecurityStatus, type SecurityAgent } from "@/lib/security-status";

/** Read-only summary of "is this install configured safely?" — drives the
 *  Security panel on /settings. Admin-only. The actual rollup logic lives
 *  in src/lib/security-status.ts so it's unit-testable. */
export const GET = withUserAdmin(async () => {
  const db = await getDbAsync();
  const agents = await db.all<SecurityAgent>(
    `SELECT id, name, cli, type, permission_mode, can_use_shell, can_read_env_vars, can_update_status FROM agents`,
  );
  const jobEnvVarsRow = await db.get<{ n: number }>(`SELECT COUNT(*) as n FROM job_env_vars`);
  return NextResponse.json(computeSecurityStatus(agents, Number(jobEnvVarsRow?.n ?? 0)));
});
