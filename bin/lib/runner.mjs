import { loadRunnerConfigs, loadSessions, saveSessions } from "./config.mjs";
import { getProvider, ensureWorkingDir, runCliTool } from "./providers.mjs";
import { spawn } from "child_process";

async function apiCall(url, apiKey, method = "GET", body = null) {
  const opts = {
    method,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${url} failed (${res.status}): ${text}`);
  }
  return res.json();
}

function buildApiPrompt(api, apiKey) {
  const runStatusUrl = api.endpoints.update_status.replace("PUT ", "");
  const activityUrl = api.endpoints.post_activity.replace("POST ", "");
  const guideUrl = api.endpoints.guide.replace("GET ", "");

  return `## Harbour API

Your output will be posted as a comment on this run. Write a clear, concise summary.

You MUST set a final run status when finished. If you don't, the run will be marked as failed.
Use these curl commands with the provided API key:

Set status to done (completed successfully):
  curl -X PUT ${runStatusUrl} -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" -d '{"status":"done"}'

Set status to waiting (you need human input — explain what you need in an activity message first):
  curl -X PUT ${runStatusUrl} -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" -d '{"status":"waiting"}'

Set status to failed (something went wrong):
  curl -X PUT ${runStatusUrl} -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" -d '{"status":"failed"}'

Post an activity message (visible on dashboard):
  curl -X POST ${activityUrl} -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" -d '{"content":"your message"}'

Full API spec (docs, databases, etc): ${guideUrl}
`;
}

function buildPrompt(payload, apiKey, isResume) {
  const apiPrompt = payload.api ? buildApiPrompt(payload.api, apiKey) : "";

  if (isResume) {
    const activity = payload.run.activity || [];
    const lastAgentIdx = activity.findLastIndex(a => a.author_type === "agent");
    const newMessages = lastAgentIdx >= 0 ? activity.slice(lastAgentIdx + 1) : activity;
    const humanMessages = newMessages
      .filter(a => a.author_type === "user" || a.author_type === "system")
      .map(a => `[${a.author_type}] ${a.content}`)
      .join("\n\n");

    return `The human has responded to your previous work. Here is their message:\n\n${humanMessages}\n\nContinue working on this task based on their response.\n\n${apiPrompt}`;
  }

  let prompt = "";

  if (payload.job?.name) {
    prompt += `# Job: ${payload.job.name}\n\n`;
  }
  if (payload.job?.instructions) {
    prompt += `## Instructions\n\n${payload.job.instructions}\n\n`;
  }

  if (payload.docs?.length > 0) {
    prompt += `## Reference Documents\n\n`;
    for (const doc of payload.docs) {
      prompt += `### ${doc.title}\n\n${doc.content || "(empty)"}\n\n`;
    }
  }

  if (payload.data && Object.keys(payload.data).length > 0) {
    prompt += `## Reference Data\n\n`;
    for (const [name, rows] of Object.entries(payload.data)) {
      prompt += `### ${name}\n\n`;
      if (rows.length > 0) {
        prompt += `\`\`\`json\n${JSON.stringify(rows.slice(0, 20), null, 2)}\n\`\`\`\n\n`;
      } else {
        prompt += `(no rows)\n\n`;
      }
    }
  }

  const activity = payload.run.activity || [];
  if (activity.length > 0) {
    prompt += `## Activity Log\n\n`;
    for (const a of activity) {
      prompt += `[${a.author_type}] ${a.content}\n\n`;
    }
  }

  if (payload.env && Object.keys(payload.env).length > 0) {
    prompt += `## Environment Variables\n\nThese credentials and secrets are available for this run. Use them when making API calls or authenticating with services.\n\n`;
    for (const [key, value] of Object.entries(payload.env)) {
      prompt += `- \`${key}\`: \`${value}\`\n`;
    }
    prompt += "\n";
  }

  // Check output is appended by the runner after executing the check command
  // (see runSingleAgent — check commands are run as shell processes, not by the LLM)

  prompt += apiPrompt;

  return prompt;
}

/**
 * Run a pre-run check command. Pipes the full payload JSON to stdin.
 * Exit 0 = work found (proceed), exit 1 = no work (skip silently), exit 2+ = error.
 * Returns { code, stdout, stderr }.
 */
function runCheckCommand(command, payloadJson, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", command], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => resolve({ code, stdout, stderr }));

    // Pipe the payload to stdin
    child.stdin.write(payloadJson);
    child.stdin.end();
  });
}

async function runSingleAgent(runner) {
  const { agentId, apiKey, cli, model: agentModel, thinking: agentThinking, name: agentName, url } = runner;
  const provider = getProvider(cli);
  const sessions = loadSessions();

  console.log(`  [${agentName}] Polling...`);

  // Poll for next run
  let payload;
  try {
    payload = await apiCall(`${url}/api/agents/${agentId}/next`, apiKey);
  } catch (err) {
    console.error(`  [${agentName}] Poll failed: ${err.message}`);
    return;
  }

  if (!payload || !payload.run) {
    console.log(`  [${agentName}] Nothing to do.`);
    return;
  }

  const runId = payload.run.id;
  const existingSession = sessions[runId];
  const isResume = !!existingSession;
  let sessionId = existingSession?.sessionId || null;
  const isNewSession = !isResume;

  // For Claude, generate a session ID upfront so we can always resume
  if (isNewSession && provider.generateSessionId) {
    sessionId = provider.generateSessionId();
  }

  console.log(`  [${agentName}] ${isResume ? "Resuming" : "Starting"} run ${runId} (${payload.job?.name || "one-off"})`);

  // Execute pre-run check command (if defined) before invoking the LLM
  let checkOutput = "";
  if (!isResume && payload.job?.check) {
    const workingDir = ensureWorkingDir(agentName);
    try {
      const checkResult = await runCheckCommand(payload.job.check, JSON.stringify(payload), workingDir);
      if (checkResult.code !== 0) {
        console.log(`  [${agentName}] Check exited ${checkResult.code} — skipping`);
        if (checkResult.code >= 2 && checkResult.stderr?.trim()) {
          console.error(`  [${agentName}] Check error: ${checkResult.stderr.trim()}`);
        }
        try {
          await apiCall(`${url}/api/runs/${runId}/status`, apiKey, "PUT", { status: "skipped" });
        } catch { /* best effort */ }
        return;
      }
      checkOutput = checkResult.stdout?.trim() || "";
    } catch (err) {
      console.error(`  [${agentName}] Check command failed: ${err.message}`);
      try {
        await apiCall(`${url}/api/runs/${runId}/status`, apiKey, "PUT", { status: "skipped" });
      } catch { /* best effort */ }
      return;
    }
  }

  // Build prompt — append check output as additional context
  let prompt = buildPrompt(payload, apiKey, isResume);
  if (checkOutput) {
    prompt += `## Pre-run Check Output\n\n${checkOutput}\n\n`;
  }

  // Build CLI command — job-level model/thinking override agent defaults
  const model = payload.job?.model || agentModel;
  const thinking = payload.job?.thinking || agentThinking;
  const workingDir = ensureWorkingDir(agentName);
  const cmd = provider.buildCommand(prompt, model, workingDir, sessionId, isNewSession, thinking);

  // Batch streaming events and flush to Harbour periodically
  let eventBatch = [];
  let flushTimer = null;
  const FLUSH_INTERVAL = 750; // ms

  async function flushEvents() {
    if (eventBatch.length === 0) return;
    const batch = eventBatch;
    eventBatch = [];
    try {
      await apiCall(`${url}/api/runs/${runId}/output`, apiKey, "POST", batch);
    } catch (err) {
      console.error(`  [${agentName}] Failed to stream output: ${err.message}`);
    }
  }

  function queueEvent(evt) {
    eventBatch.push(evt);
    if (!flushTimer) {
      flushTimer = setTimeout(async () => {
        flushTimer = null;
        await flushEvents();
      }, FLUSH_INTERVAL);
    }
  }

  // Line handler: parse each JSONL line from the CLI tool
  function onLine(line) {
    if (!provider.parseLine) return;
    const parsed = provider.parseLine(line);
    if (!parsed) return;

    // Capture session ID from init events
    if (parsed.sessionId && !sessionId) {
      sessionId = parsed.sessionId;
    } else if (parsed.sessionId) {
      sessionId = parsed.sessionId;
    }

    for (const evt of parsed.events) {
      queueEvent(evt);
    }
  }

  // Execute CLI tool with streaming (use per-job timeout, fallback to 30 min)
  const timeoutMinutes = payload.job?.timeout_minutes || 30;
  const timeoutMs = timeoutMinutes * 60 * 1000;
  let result;
  try {
    result = await runCliTool(cmd.binary, cmd.args, cmd.cwd, { timeoutMs, onLine });
  } catch (err) {
    console.error(`  [${agentName}] CLI execution failed: ${err.message}`);
    try {
      await apiCall(`${url}/api/runs/${runId}/activity`, apiKey, "POST", {
        content: `Runner error: CLI tool "${cli}" failed to execute: ${err.message}`,
      });
      await apiCall(`${url}/api/runs/${runId}/status`, apiKey, "PUT", { status: "failed" });
    } catch { /* best effort */ }
    return;
  }

  // Flush any remaining buffered events
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushEvents();

  // Parse final result for activity summary
  const parsed = provider.parseResult(result.stdout, sessionId);
  const output = parsed.content || result.stdout || result.stderr || "(no output)";
  const newSessionId = parsed.sessionId || sessionId;

  // Check if CLI exited with error
  if (result.code !== 0) {
    console.error(`  [${agentName}] CLI exited with code ${result.code}`);

    // Build a human-readable error reason
    let reason;
    if (result.code === 143) {
      reason = `Process was killed (SIGTERM) — likely hit the ${timeoutMinutes}-minute timeout before the CLI exited cleanly.`;
    } else if (result.code === 137) {
      reason = `Process was force-killed (SIGKILL) — out of memory or hard timeout.`;
    } else {
      reason = `CLI exited with code ${result.code}.`;
    }

    // Filter out raw streaming protocol lines from stdout — keep only readable content
    const sanitizedOutput = output
      .split("\n")
      .filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        // Skip raw JSONL streaming protocol lines
        try {
          const obj = JSON.parse(trimmed);
          if (obj.type === "stream_event" || obj.type === "assistant" || obj.type === "system") return false;
        } catch { /* not JSON — keep it */ }
        return true;
      })
      .join("\n")
      .trim();

    // Combine reason + stderr + any remaining meaningful output
    let errorContent = `**${reason}**`;
    if (result.stderr?.trim()) errorContent += `\n\nstderr:\n${result.stderr.trim()}`;
    if (sanitizedOutput) errorContent += `\n\nOutput:\n${sanitizedOutput}`;
    if (errorContent.length > 4000) errorContent = errorContent.slice(-4000);

    try {
      await apiCall(`${url}/api/runs/${runId}/activity`, apiKey, "POST", {
        content: errorContent,
      });
      await apiCall(`${url}/api/runs/${runId}/status`, apiKey, "PUT", { status: "failed" });
    } catch { /* best effort */ }

    delete sessions[runId];
    saveSessions(sessions);
    return;
  }

  // Post output as activity (high-level summary)
  const truncatedOutput = output.length > 50000 ? output.slice(-50000) : output;
  try {
    await apiCall(`${url}/api/runs/${runId}/activity`, apiKey, "POST", {
      content: truncatedOutput,
    });
  } catch (err) {
    console.error(`  [${agentName}] Failed to post activity: ${err.message}`);
  }

  // Check if the agent already set a terminal status (done/failed/waiting/skipped).
  // If not, the agent didn't follow the instructions — mark as failed.
  let currentStatus = "running";
  try {
    const run = await apiCall(`${url}/api/runs/${runId}`, apiKey);
    currentStatus = run.status;
  } catch { /* best effort — fall through to failsafe */ }

  const terminalStatuses = ["done", "failed", "waiting", "skipped"];
  if (!terminalStatuses.includes(currentStatus)) {
    console.warn(`  [${agentName}] Agent did not set a final status (still "${currentStatus}") — marking as failed`);
    try {
      await apiCall(`${url}/api/runs/${runId}/activity`, apiKey, "POST", {
        content: "Run marked as failed: agent did not set a final status.",
      });
      await apiCall(`${url}/api/runs/${runId}/status`, apiKey, "PUT", { status: "failed" });
    } catch { /* best effort */ }
    currentStatus = "failed";
  }

  // Save session for resume if waiting, clean up otherwise
  if (newSessionId && currentStatus === "waiting") {
    sessions[runId] = { sessionId: newSessionId, cli };
    saveSessions(sessions);
  } else {
    delete sessions[runId];
    saveSessions(sessions);
  }

  console.log(`  [${agentName}] Run ${runId} completed with status: ${currentStatus}`);
}

export async function runAgents() {
  const runners = loadRunnerConfigs();
  if (runners.length === 0) {
    console.log("No harbour agents configured. Create one from the dashboard.");
    return;
  }

  console.log(`Polling ${runners.length} harbour agent(s)...`);

  const work = [];
  for (const runner of runners) {
    work.push(runSingleAgent(runner));
  }

  await Promise.allSettled(work);

  console.log("Done.");
}
