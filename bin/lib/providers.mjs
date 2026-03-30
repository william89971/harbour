import { spawn, execSync } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";
import crypto from "crypto";

// Cache resolved binary paths
const binaryPathCache = {};
function resolveBinary(name) {
  if (!binaryPathCache[name]) {
    try {
      binaryPathCache[name] = execSync(`which ${name}`, { encoding: "utf-8" }).trim();
    } catch {
      binaryPathCache[name] = name; // fallback to bare name
    }
  }
  return binaryPathCache[name];
}

// Provider: how to invoke each CLI tool in batch mode

const PROVIDERS = {
  claude: {
    // Claude: we generate our own session UUID, so we always know the session_id.
    // Use --output-format text for clean output.
    generateSessionId() {
      return crypto.randomUUID();
    },
    buildCommand(prompt, model, workingDir, sessionId, isNewSession) {
      const args = ["-p", "--output-format", "text", "--dangerously-skip-permissions"];
      if (model) args.push("--model", model);
      if (isNewSession && sessionId) {
        args.push("--session-id", sessionId);
      } else if (sessionId) {
        args.push("--resume", sessionId);
      }
      args.push(prompt);
      return { binary: resolveBinary("claude"), args, cwd: workingDir };
    },
    parseResult(stdout, presetSessionId) {
      // With --output-format text, stdout is just the text response
      return { content: stdout.trim(), sessionId: presetSessionId };
    },
  },

  codex: {
    // Codex: session_id (thread_id) is captured from --json output
    buildCommand(prompt, model, workingDir, sessionId) {
      if (sessionId) {
        const args = ["exec", "resume", "--dangerously-bypass-approvals-and-sandbox", "--json"];
        if (model) args.push("-m", model);
        args.push(sessionId, prompt);
        return { binary: resolveBinary("codex"), args, cwd: workingDir };
      }
      const args = ["exec", "--dangerously-bypass-approvals-and-sandbox", "--json"];
      if (model) args.push("-m", model);
      args.push(prompt);
      return { binary: resolveBinary("codex"), args, cwd: workingDir };
    },
    parseResult(stdout) {
      const lines = stdout.trim().split("\n");
      let sessionId = null;
      let content = "";

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === "thread.started" && obj.thread_id) {
            sessionId = obj.thread_id;
          }
          // item.completed can have text directly or in content array
          if (obj.type === "item.completed" && obj.item) {
            if (obj.item.text) {
              content += obj.item.text + "\n";
            } else if (obj.item.content) {
              for (const c of obj.item.content) {
                if (c.type === "output_text" || c.type === "text") {
                  content += (c.text || "") + "\n";
                }
              }
            }
          }
          if (obj.type === "message.completed" && obj.message) {
            if (obj.message.text) {
              content += obj.message.text + "\n";
            } else if (obj.message.content) {
              for (const c of obj.message.content) {
                if (c.type === "output_text" || c.type === "text") {
                  content += (c.text || "") + "\n";
                }
              }
            }
          }
        } catch {
          // Not JSON line
        }
      }

      if (!content.trim()) content = stdout;
      return { content: content.trim(), sessionId };
    },
  },

  gemini: {
    // Gemini: -p takes the prompt as its value. Use -o stream-json to capture session_id.
    buildCommand(prompt, model, workingDir, sessionId) {
      const args = ["--prompt", prompt, "--yolo", "-o", "stream-json"];
      if (model) args.push("-m", model);
      if (sessionId) {
        args.push("--resume", sessionId);
      }
      return { binary: resolveBinary("gemini"), args, cwd: workingDir };
    },
    parseResult(stdout) {
      const lines = stdout.trim().split("\n");
      let sessionId = null;
      let content = "";

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          // session_id from init event
          if (obj.type === "init" && obj.session_id) {
            sessionId = obj.session_id;
          }
          // Assistant messages (delta: true are streaming chunks)
          if (obj.type === "message" && obj.role === "assistant" && obj.content) {
            content += obj.content;
          }
        } catch {
          // Not JSON — skip stderr noise
        }
      }

      if (!content.trim()) content = stdout;
      return { content: content.trim(), sessionId };
    },
  },
};

export function getProvider(cli) {
  const provider = PROVIDERS[cli];
  if (!provider) throw new Error(`Unknown CLI provider: ${cli}`);
  return provider;
}

export function ensureWorkingDir(agentName) {
  const dir = path.join(os.homedir(), ".harbour", "workspaces", agentName.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function runCliTool(binary, args, cwd, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    // Build clean environment: strip Claude Code nesting guards that prevent
    // spawned CLI tools from running inside a Claude Code session
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    delete env.CLAUDE_CODE_SESSION;
    delete env.CLAUDE_CODE_PARENT_SESSION;

    const child = spawn(binary, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env,
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}
