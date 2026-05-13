import { NextResponse } from "next/server";
// User-only: settings are operator/admin config, not part of the agent
// contract. Sensitive values are masked, but the rest (timezone, captain
// config, signup_enabled, etc.) shouldn't be enumerated by agents.
import { withUserAuth, requireAdmin } from "@/lib/auth";
import { getAllSettingsAsync, setSettingAsync, isSensitiveSetting, maskSettingValue } from "@/lib/db/queries";

export const GET = withUserAuth(async () => {
  const settings = await getAllSettingsAsync();
  for (const key of Object.keys(settings)) {
    if (isSensitiveSetting(key)) {
      settings[key] = maskSettingValue(settings[key]);
    }
  }
  return NextResponse.json(settings);
});

export const PUT = withUserAuth(async (req, auth) => {
  const e = requireAdmin(auth); if (e) return e;
  const body = await req.json();
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      await setSettingAsync(key, value);
    }
  }

  const settings = await getAllSettingsAsync();
  for (const key of Object.keys(settings)) {
    if (isSensitiveSetting(key)) {
      settings[key] = maskSettingValue(settings[key]);
    }
  }
  return NextResponse.json(settings);
});
