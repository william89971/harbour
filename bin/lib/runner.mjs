import { loadRunnerConfigs, loadSessions, saveSessions } from "./config.mjs";
import { getProvider, ensureWorkingDir, runCliTool } from "./providers.mjs";

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

  if (payload.job?.check) {
    prompt += `## Pre-run Check\n\nBefore starting, run this command: \`${payload.job.check}\`\nIf it returns non-zero, skip this run by setting status to "skipped".\n\n`;
  }

  prompt += apiPrompt;

  return prompt;
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

  // Build prompt
  const prompt = buildPrompt(payload, apiKey, isResume);

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

  // Execute CLI tool with streaming
  let result;
  try {
    result = await runCliTool(cmd.binary, cmd.args, cmd.cwd, { onLine });
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
    // Include stderr in the error output — auth failures, missing config, etc.
    const errorOutput = result.stderr ? `${output}\n\nstderr:\n${result.stderr}` : output;
    const errorContent = errorOutput.length > 4000 ? errorOutput.slice(-4000) : errorOutput;
    try {
      await apiCall(`${url}/api/runs/${runId}/activity`, apiKey, "POST", {
        content: `Agent encountered an error (exit code ${result.code}):\n\n${errorContent}`,
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
