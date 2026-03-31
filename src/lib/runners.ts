import fs from "fs";
import path from "path";
import os from "os";

const HARBOUR_DIR = path.join(os.homedir(), ".harbour");
const RUNNERS_FILE = path.join(HARBOUR_DIR, "runners.json");

export type RunnerConfig = {
  agentId: string;
  name: string;
  apiKey: string;
  cli: string;
  model: string | null;
  thinking: string | null;
  url: string;
};

function ensureDir() {
  if (!fs.existsSync(HARBOUR_DIR)) {
    fs.mkdirSync(HARBOUR_DIR, { recursive: true });
  }
}

export function loadRunners(): RunnerConfig[] {
  if (!fs.existsSync(RUNNERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(RUNNERS_FILE, "utf-8")).runners || [];
}

function saveRunners(runners: RunnerConfig[]) {
  ensureDir();
  fs.writeFileSync(RUNNERS_FILE, JSON.stringify({ runners }, null, 2));
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
