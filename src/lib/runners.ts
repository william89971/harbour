import fs from "fs";
import { runnersFile, harbourHome, ensureDir } from "./paths";

export type RunnerConfig = {
  agentId: string;
  name: string;
  apiKey: string;
  cli: string;
  model: string | null;
  thinking: string | null;
  eager?: boolean;
  maxConcurrentRuns?: number;
  /** Custom Shell provider: the user-supplied command and optional cwd. */
  shellCommand?: string | null;
  shellCwd?: string | null;
  /** Persisted fallback so the runner can pick a permission mode for older
   *  payloads that don't include the field. Live value still comes from
   *  /api/agents/:id/next so dashboard changes take effect immediately. */
  permissionMode?: "safe" | "custom" | "unrestricted";
  /** API-agent fields. apiBaseUrl is the OpenAI-compatible chat endpoint
   *  base URL (e.g. https://api.deepseek.com/v1). apiKeyEnv is the env-var
   *  name the runner reads to authenticate to that endpoint — the key is
   *  NEVER stored in runners.json. */
  apiBaseUrl?: string | null;
  apiKeyEnv?: string | null;
  url: string;
};

export function loadRunners(): RunnerConfig[] {
  const file = runnersFile();
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf-8")).runners || [];
}

function saveRunners(runners: RunnerConfig[]) {
  ensureDir(harbourHome());
  fs.writeFileSync(runnersFile(), JSON.stringify({ runners }, null, 2));
}

export function saveRunnerConfig(config: RunnerConfig) {
  const runners = loadRunners();
  const existing = runners.findIndex(r => r.agentId === config.agentId);
  if (existing >= 0) {
    runners[existing] = config;
  } else {
    runners.push(config);
  }
  saveRunners(runners);
}

export function removeRunnerConfig(agentId: string) {
  const runners = loadRunners().filter(r => r.agentId !== agentId);
  saveRunners(runners);
}
