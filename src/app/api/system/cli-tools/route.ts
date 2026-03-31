import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { execSync } from "child_process";

const CLI_TOOLS = [
  { id: "claude", name: "Claude", binary: "claude", versionFlag: "--version" },
  { id: "codex", name: "Codex", binary: "codex", versionFlag: "--version" },
  { id: "gemini", name: "Gemini", binary: "gemini", versionFlag: "--version" },
];

function checkTool(tool: typeof CLI_TOOLS[number]) {
  try {
    const whichResult = execSync(`which ${tool.binary} 2>/dev/null`, { encoding: "utf-8" }).trim();
    if (!whichResult) return { id: tool.id, name: tool.name, installed: false };

    let version = null;
    try {
      version = execSync(`${tool.binary} ${tool.versionFlag} 2>/dev/null`, { encoding: "utf-8", timeout: 5000 }).trim();
      // Extract just the version number if there's extra text
      const match = version.match(/[\d]+\.[\d]+[\d.]*/);
      if (match) version = match[0];
    } catch { /* version check failed, binary still exists */ }

    return { id: tool.id, name: tool.name, installed: true, version, path: whichResult };
  } catch {
    return { id: tool.id, name: tool.name, installed: false };
  }
}

export const GET = withAuth(async () => {
  const tools = CLI_TOOLS.map(checkTool);
  return NextResponse.json(tools);
});
