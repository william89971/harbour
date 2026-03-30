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

// Normalized event types emitted by all providers:
//   text_delta   — streaming text content
//   tool_start   — agent started using a tool
//   tool_end     — tool execution finished (with output)
//   thinking     — model thinking/reasoning
//   info         — system info (init, model, etc.)
//   error        — error message
//   result       — final summary

// Provider: how to invoke each CLI tool in batch mode, with streaming support

const PROVIDERS = {
  claude: {
    generateSessionId() {
      return crypto.randomUUID();
    },
    buildCommand(prompt, model, workingDir, sessionId, isNewSession) {
      const args = [
        "-p",
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--dangerously-skip-permissions",
      ];
      if (model) args.push("--model", model);
      if (isNewSession && sessionId) {
        args.push("--session-id", sessionId);
      } else if (sessionId) {
        args.push("--resume", sessionId);
      }
      args.push(prompt);
      return { binary: resolveBinary("claude"), args, cwd: workingDir };
    },
    // Parse a single JSONL line into normalized events
    parseLine(line) {
      try {
        const obj = JSON.parse(line);
        const events = [];

        if (obj.type === "system" && obj.subtype === "init") {
          events.push({ event_type: "info", content: `Model: ${obj.model}` });
          return { events, sessionId: obj.session_id };
        }

        if (obj.type === "stream_event" && obj.event) {
          const evt = obj.event;
          if (evt.type === "content_block_delta") {
            if (evt.delta?.type === "text_delta" && evt.delta.text) {
              events.push({ event_type: "text_delta", content: evt.delta.text });
            }
            if (evt.delta?.type === "thinking_delta" && evt.delta.thinking) {
              events.push({ event_type: "thinking", content: evt.delta.thinking });
            }
          }
          if (evt.type === "content_block_start" && evt.content_block?.type === "tool_use") {
            events.push({
              event_type: "tool_start",
              content: null,
              tool_name: evt.content_block.name,
            });
          }
        }

        // Tool result comes as an assistant message with tool_result content
        if (obj.type === "assistant" && obj.message?.content) {
          for (const block of obj.message.content) {
            if (block.type === "tool_result") {
              events.push({
                event_type: "tool_end",
                content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
                tool_name: null,
              });
            }
          }
        }

        if (obj.type === "result") {
          events.push({
            event_type: "result",
            content: obj.result || null,
          });
          return { events, sessionId: obj.session_id };
        }

        return { events };
      } catch {
        return { events: [] };
      }
    },
    parseResult(stdout, presetSessionId) {
      // Fallback full-parse for final content extraction
      const lines = stdout.trim().split("\n");
      let content = "";
      let sessionId = presetSessionId;
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === "result" && obj.result) {
            content = obj.result;
          }
          if (obj.session_id) sessionId = obj.session_id;
        } catch { /* skip */ }
      }
      if (!content) content = stdout;
      return { content: content.trim(), sessionId };
    },
  },

  codex: {
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
    parseLine(line) {
      try {
        const obj = JSON.parse(line);
        const events = [];

        if (obj.type === "thread.started" && obj.thread_id) {
          events.push({ event_type: "info", content: `Thread: ${obj.thread_id}` });
          return { events, sessionId: obj.thread_id };
        }

        if (obj.type === "item.started" && obj.item) {
          if (obj.item.type === "command_execution") {
            events.push({
              event_type: "tool_start",
              content: obj.item.command || null,
              tool_name: "shell",
            });
          }
        }

        if (obj.type === "item.completed" && obj.item) {
          if (obj.item.type === "agent_message" && obj.item.text) {
            events.push({ event_type: "text_delta", content: obj.item.text });
          }
          if (obj.item.type === "command_execution") {
            events.push({
              event_type: "tool_end",
              content: obj.item.aggregated_output != null && obj.item.aggregated_output !== ""
                ? obj.item.aggregated_output
                : `exit ${obj.item.exit_code}`,
              tool_name: "shell",
            });
          }
        }

        if (obj.type === "turn.completed") {
          events.push({
            event_type: "result",
            content: obj.usage ? `Tokens: ${obj.usage.input_tokens} in / ${obj.usage.output_tokens} out` : null,
          });
        }

        return { events };
      } catch {
        return { events: [] };
      }
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
        } catch { /* Not JSON line */ }
      }

      if (!content.trim()) content = stdout;
      return { content: content.trim(), sessionId };
    },
  },

  gemini: {
    buildCommand(prompt, model, workingDir, sessionId) {
      const args = ["--prompt", prompt, "--yolo", "-o", "stream-json"];
      if (model) args.push("-m", model);
      if (sessionId) {
        args.push("--resume", sessionId);
      }
      return { binary: resolveBinary("gemini"), args, cwd: workingDir };
    },
    parseLine(line) {
      try {
        const obj = JSON.parse(line);
        const events = [];

        if (obj.type === "init" && obj.session_id) {
          events.push({ event_type: "info", content: `Model: ${obj.model}` });
          return { events, sessionId: obj.session_id };
        }

        if (obj.type === "message" && obj.role === "assistant" && obj.content) {
          events.push({ event_type: "text_delta", content: obj.content });
        }

        if (obj.type === "tool_use") {
          events.push({
            event_type: "tool_start",
            content: obj.parameters ? JSON.stringify(obj.parameters) : null,
            tool_name: obj.tool_name || null,
          });
        }

        if (obj.type === "tool_result") {
          events.push({
            event_type: "tool_end",
            content: obj.output || null,
            tool_name: null,
          });
        }

        if (obj.type === "result") {
          const stats = obj.stats;
          events.push({
            event_type: "result",
            content: stats ? `Tokens: ${stats.input_tokens} in / ${stats.output_tokens} out, ${stats.duration_ms}ms` : null,
          });
        }

        return { events };
      } catch {
        return { events: [] };
      }
    },
    parseResult(stdout) {
      const lines = stdout.trim().split("\n");
      let sessionId = null;
      let content = "";

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === "init" && obj.session_id) {
            sessionId = obj.session_id;
          }
          if (obj.type === "message" && obj.role === "assistant" && obj.content) {
            content += obj.content;
          }
        } catch { /* Not JSON — skip stderr noise */ }
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

/**
 * Run a CLI tool, streaming JSONL output line-by-line to onLine callback.
 * Returns { code, stdout, stderr } when the process exits.
 */
export function runCliTool(binary, args, cwd, { timeoutMs = 10 * 60 * 1000, onLine } = {}) {
  return new Promise((resolve, reject) => {
    // Build clean environment: strip Claude Code nesting guards
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
    let lineBuffer = "";

    child.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;

      if (onLine) {
        lineBuffer += chunk;
        const lines = lineBuffer.split("\n");
        // Keep the last incomplete line in the buffer
        lineBuffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) onLine(trimmed);
        }
      }
    });

    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      // Flush remaining buffer
      if (onLine && lineBuffer.trim()) {
        onLine(lineBuffer.trim());
      }
      resolve({ code, stdout, stderr });
    });
  });
}
