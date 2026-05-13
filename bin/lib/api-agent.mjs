/**
 * API-agent provider runtime.
 *
 * Drives a function-calling loop against an OpenAI-compatible
 * chat/completions endpoint (DeepSeek, Kimi, OpenAI, anything that
 * implements the same wire format). The model never gets shell access —
 * every "tool" it can call is an HTTP endpoint on the Harbour server,
 * filtered by the agent's tool_permissions.
 *
 * Contract:
 *
 *   runApiAgent({
 *     prompt,              // string — the run's instructions + context
 *     apiBaseUrl,          // string — base URL ending in /v1 (no trailing slash)
 *     apiKey,              // string — the model API key (NOT the Harbour key)
 *     model,               // string — model id passed to chat/completions
 *     toolPermissions,     // ToolPermissions — gates the tool spec
 *     harbour: { url, apiKey, agentId, runId, jobId },
 *     env,                 // job-injected env vars (read_env_vars tool reads these)
 *     onLine,              // (line) => void — emits text deltas + tool events
 *     signal,              // AbortSignal — runner kill plumbing
 *     maxIterations,       // default 25
 *     timeoutMs,           // overall ceiling per request
 *   }) => { content, sessionId: null, usage }
 *
 * The function NEVER calls update_status or post_activity itself — the
 * runner does that based on the returned content + outcome. That keeps
 * the api-agent code path identical from the runner's perspective to
 * spawning a CLI tool.
 */

const HARBOUR_TOOLS = [
  {
    name: "post_activity",
    description: "Post a message to the run's activity log, visible on the dashboard. Use this to narrate progress.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Message text. Markdown supported." },
      },
      required: ["content"],
    },
  },
  {
    name: "read_doc",
    description: "Read the full contents of a Harbour doc by id.",
    parameters: {
      type: "object",
      properties: { doc_id: { type: "string" } },
      required: ["doc_id"],
    },
  },
  {
    name: "list_docs",
    description: "List Harbour docs (id, title, summary, pinned flag).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "write_doc",
    description: "Create a new doc or update an existing one. Pass doc_id to update; omit to create.",
    parameters: {
      type: "object",
      properties: {
        doc_id: { type: "string", description: "Existing doc id. If absent, a new doc is created." },
        title: { type: "string" },
        content: { type: "string" },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "read_database_rows",
    description: "Read rows from a Harbour database. Returns paginated JSON.",
    parameters: {
      type: "object",
      properties: {
        database_id: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 500 },
        offset: { type: "integer", minimum: 0 },
      },
      required: ["database_id"],
    },
  },
  {
    name: "insert_database_rows",
    description: "Insert one or more rows into a Harbour database.",
    parameters: {
      type: "object",
      properties: {
        database_id: { type: "string" },
        rows: { type: "array", items: { type: "object" } },
      },
      required: ["database_id", "rows"],
    },
  },
  {
    name: "read_env_var",
    description: "Read the value of a job-linked environment variable. Returns null if not set.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "create_handoff",
    description: "Hand the conversation off to another agent or team. Marks this run as done and creates a follow-up run.",
    parameters: {
      type: "object",
      properties: {
        target_agent_id: { type: "string" },
        target_team_id: { type: "string" },
        target_role: { type: "string" },
        message: { type: "string", description: "Context the next agent should see." },
      },
      required: ["message"],
    },
  },
  {
    name: "finish",
    description: "Indicate the run is complete. Pass the final message that should appear as the agent's last activity entry. Note: the status field is only applied if you have the update_status tool permission; otherwise the run will continue until it times out, which is the correct outcome for an agent that cannot advance state.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string" },
        status: { type: "string", enum: ["done", "failed", "waiting"], default: "done" },
      },
      required: ["content"],
    },
  },
];

/** Map each tool to the permission flag(s) required to invoke it. The
 *  tool spec sent to the model is filtered by these. */
const TOOL_PERMISSION_MAP = {
  post_activity:        "post_activity",
  read_doc:             "read_docs",
  list_docs:            "read_docs",
  write_doc:            "write_docs",
  read_database_rows:   "read_databases",
  insert_database_rows: "write_databases",
  read_env_var:         "read_env_vars",
  create_handoff:       "create_handoffs",
  finish:               null, // always available
};

function filteredTools(toolPermissions) {
  // Defensive: a remote runner polling an older server may receive a
  // payload without tool_permissions. Treat null/undefined as "no
  // restrictions" so the agent runtime keeps working with pre-feature
  // server versions.
  const tp = toolPermissions || null;
  return HARBOUR_TOOLS.filter(t => {
    const required = TOOL_PERMISSION_MAP[t.name];
    if (required === null || required === undefined) return true;
    if (!tp) return true;
    return !!tp[required];
  });
}

function toolSpecForApi(tools) {
  return tools.map(t => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

async function harbourFetch(harbour, method, pathSuffix, body) {
  const url = `${harbour.url}${pathSuffix}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${harbour.apiKey}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* leave as text */ }
  return { ok: res.ok, status: res.status, body: parsed };
}

/** Dispatch a tool call to the corresponding Harbour HTTP endpoint (or
 *  to the in-memory env-vars table for read_env_var). Always returns a
 *  string the model will see as the tool result. */
async function dispatchToolCall(name, args, ctx) {
  const { harbour, env } = ctx;
  switch (name) {
    case "post_activity": {
      const r = await harbourFetch(harbour, "POST", `/api/runs/${harbour.runId}/activity`, { content: String(args?.content ?? "") });
      return r.ok ? "ok" : `error: ${r.status} ${JSON.stringify(r.body)}`;
    }
    case "read_doc": {
      const r = await harbourFetch(harbour, "GET", `/api/docs/${encodeURIComponent(args?.doc_id ?? "")}`);
      return JSON.stringify(r.body);
    }
    case "list_docs": {
      const r = await harbourFetch(harbour, "GET", `/api/docs`);
      return JSON.stringify(r.body);
    }
    case "write_doc": {
      if (args?.doc_id) {
        const r = await harbourFetch(harbour, "PUT", `/api/docs/${encodeURIComponent(args.doc_id)}`, {
          title: args.title, content: args.content,
        });
        return JSON.stringify(r.body);
      }
      const r = await harbourFetch(harbour, "POST", `/api/docs`, {
        title: args?.title, content: args?.content,
      });
      return JSON.stringify(r.body);
    }
    case "read_database_rows": {
      const q = new URLSearchParams();
      if (args?.limit != null) q.set("limit", String(args.limit));
      if (args?.offset != null) q.set("offset", String(args.offset));
      const r = await harbourFetch(harbour, "GET", `/api/databases/${encodeURIComponent(args?.database_id ?? "")}/rows?${q}`);
      return JSON.stringify(r.body);
    }
    case "insert_database_rows": {
      const r = await harbourFetch(harbour, "POST", `/api/databases/${encodeURIComponent(args?.database_id ?? "")}/rows`, args?.rows ?? []);
      return JSON.stringify(r.body);
    }
    case "read_env_var": {
      const v = env?.[args?.name];
      return v != null ? String(v) : "null";
    }
    case "create_handoff": {
      const r = await harbourFetch(harbour, "POST", `/api/runs/${harbour.runId}/handoff`, {
        targetAgentId: args?.target_agent_id,
        targetTeamId: args?.target_team_id,
        targetRole: args?.target_role,
        message: args?.message,
      });
      return JSON.stringify(r.body);
    }
    case "finish":
      return "ok"; // sentinel — handled by the loop
    default:
      return `error: unknown tool '${name}'`;
  }
}

/**
 * Decide what the runner should do at the end of an api-agent run, given
 * the agent's tool permissions. Pure function so it's testable without
 * spinning up a real HTTP stack.
 *
 * Returns:
 *   - postContent: string to POST to /activity, or null to skip
 *   - putStatus:   status to PUT to /status, or null to skip
 *   - noteContent: optional system note to POST as activity when the
 *                  runner wants to make a permission-skip visible
 *   - reason:      short string for runner logging
 *
 * Behavior matrix:
 *   - canActivity && canStatus → post content + put status (normal case)
 *   - canActivity && !canStatus → post content + a system note explaining
 *     why status wasn't updated; run will sit in running until timeout
 *   - !canActivity && canStatus → put status only; content is dropped
 *     (the agent has no way to communicate, but at least the run closes)
 *   - !canActivity && !canStatus → nothing happens; run will time out.
 *     This is the documented degenerate state for an agent with no
 *     write permissions at all.
 */
export function decideApiFinish({ apiResult, toolPermissions }) {
  // Treat missing toolPermissions as all-on for backwards-compat with
  // remote runners polling a server that doesn't yet send the field.
  const tp = toolPermissions || null;
  const canActivity = !tp || !!tp.post_activity;
  const canStatus = !tp || !!tp.update_status;
  const finalStatus = apiResult?.finalStatus ?? null;
  const content = apiResult?.content ?? "";

  let postContent = null;
  let putStatus = null;
  let noteContent = null;
  let reason;

  if (content && canActivity) postContent = content;
  if (finalStatus && canStatus) putStatus = finalStatus;

  if (finalStatus && !canStatus) {
    if (canActivity) {
      noteContent = `Agent requested status='${finalStatus}' but update_status tool permission is off; the run cannot be closed automatically and will time out.`;
    }
    reason = "skipped-status-no-permission";
  } else if (!content && !finalStatus) {
    reason = "agent-finished-empty";
  } else {
    reason = "ok";
  }

  return { postContent, putStatus, noteContent, reason, canActivity, canStatus };
}

/** Drive one chat/completions request. Returns the assistant message
 *  (which may contain tool_calls) plus usage. */
async function chatOnce({ apiBaseUrl, apiKey, model, messages, tools, signal, timeoutMs }) {
  const ac = new AbortController();
  const t = timeoutMs ? setTimeout(() => ac.abort(), timeoutMs) : null;
  if (signal) signal.addEventListener("abort", () => ac.abort(), { once: true });
  try {
    const res = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        tools,
        tool_choice: "auto",
      }),
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`chat/completions ${res.status}: ${text}`);
    return JSON.parse(text);
  } finally {
    if (t) clearTimeout(t);
  }
}

/** Main loop. See module header for the contract. */
export async function runApiAgent(opts) {
  const {
    prompt,
    apiBaseUrl,
    apiKey,
    model,
    toolPermissions,
    harbour,
    env = {},
    onLine,
    signal,
    maxIterations = 25,
    timeoutMs = 5 * 60 * 1000,
  } = opts;

  if (!apiBaseUrl) throw new Error("api-agent: apiBaseUrl is required");
  if (!apiKey) throw new Error("api-agent: apiKey is required (resolved from the runner's apiKeyEnv)");
  if (!model) throw new Error("api-agent: model is required");

  const tools = filteredTools(toolPermissions || {});
  const messages = [
    { role: "system", content: "You are an autonomous agent running on Harbour. Use the provided tools to do the work; call the `finish` tool when you're done, passing the final summary as `content`. Do not narrate without acting." },
    { role: "user", content: prompt },
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let finalContent = "";
  // Stream a one-line info event so the dashboard shows the model + base URL.
  if (onLine) {
    onLine(JSON.stringify({ event_type: "info", content: `API agent: ${model} via ${apiBaseUrl}` }) + "\n");
  }

  for (let i = 0; i < maxIterations; i++) {
    if (signal?.aborted) throw new Error("api-agent: aborted");
    const response = await chatOnce({ apiBaseUrl, apiKey, model, messages, tools: toolSpecForApi(tools), signal, timeoutMs });

    const usage = response.usage || {};
    inputTokens += Number(usage.prompt_tokens || 0);
    outputTokens += Number(usage.completion_tokens || 0);

    const choice = response.choices?.[0];
    if (!choice) throw new Error("api-agent: response had no choices");
    const msg = choice.message || {};
    messages.push(msg);

    if (msg.content && onLine) {
      onLine(JSON.stringify({ event_type: "text_delta", content: msg.content }) + "\n");
    }

    const toolCalls = msg.tool_calls || [];
    if (toolCalls.length === 0) {
      // No further tool calls — treat the assistant text as the final answer.
      finalContent = msg.content || "";
      break;
    }

    for (const call of toolCalls) {
      const name = call.function?.name;
      let args = {};
      try { args = call.function?.arguments ? JSON.parse(call.function.arguments) : {}; } catch { /* leave empty */ }

      if (onLine) {
        onLine(JSON.stringify({ event_type: "tool_start", tool_name: name, content: JSON.stringify(args) }) + "\n");
      }

      // Honor tool_permissions even though we already filtered the spec —
      // a misbehaving model could synthesize a name that isn't in the
      // advertised list. Null/missing tool_permissions is treated as "no
      // restrictions" for remote-runner compatibility (matches filteredTools).
      const required = TOOL_PERMISSION_MAP[name];
      if (required && toolPermissions && !toolPermissions[required]) {
        const result = `error: tool '${name}' is not permitted for this agent`;
        if (onLine) onLine(JSON.stringify({ event_type: "tool_end", tool_name: name, content: result }) + "\n");
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
        continue;
      }

      // Autonomy policy gate. Reject + log on block — the LLM sees a normal
      // tool error and adapts; a human can later approve/reject the recorded
      // request from the dashboard. Network failures fall through to allow
      // (fail-open) so a temporarily unreachable harbour doesn't deadlock the
      // run; the per-agent tool_permissions above remain the hard floor.
      try {
        const policyResp = await fetch(`${harbour.url}/api/internal/autonomy/check`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${harbour.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ runId: harbour.runId, toolName: name, args }),
        });
        if (policyResp.ok) {
          const policyJson = await policyResp.json();
          if (policyJson && policyJson.allow === false) {
            const reqId = policyJson.requestId || "?";
            const reason = policyJson.reason || "requires approval";
            const result = `error: tool '${name}' requires approval (request ${reqId}): ${reason}`;
            if (onLine) onLine(JSON.stringify({ event_type: "tool_end", tool_name: name, content: result }) + "\n");
            messages.push({ role: "tool", tool_call_id: call.id, content: result });
            continue;
          }
        }
      } catch (err) {
        // Fail-open: don't block the tool call, but surface the failure so a
        // human reviewer notices the silent-allow event. Stderr alone is
        // invisible from the dashboard; an activity entry is searchable and
        // shows up next to the tool call.
        process.stderr.write(`[api-agent] autonomy check failed: ${err.message}\n`);
        try {
          await fetch(`${harbour.url}/api/runs/${harbour.runId}/activity`, {
            method: "POST",
            headers: { Authorization: `Bearer ${harbour.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              content: `⚠ Autonomy check unreachable for tool \`${name}\` — call was permitted (fail-open). Reason: ${err.message}`,
            }),
          });
        } catch { /* best effort */ }
      }

      let result;
      try {
        result = await dispatchToolCall(name, args, { harbour, env });
      } catch (err) {
        result = `error: ${err.message}`;
      }

      if (onLine) {
        onLine(JSON.stringify({ event_type: "tool_end", tool_name: name, content: typeof result === "string" ? result : JSON.stringify(result) }) + "\n");
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: typeof result === "string" ? result : JSON.stringify(result) });

      if (name === "finish") {
        finalContent = String(args?.content ?? "");
        return {
          content: finalContent,
          sessionId: null,
          usage: { provider: "api", model, input_tokens: inputTokens, output_tokens: outputTokens },
          finalStatus: args?.status || "done",
        };
      }
    }
  }

  if (!finalContent) {
    finalContent = "Reached max-iteration cap without a finish tool call.";
  }
  return {
    content: finalContent,
    sessionId: null,
    usage: { provider: "api", model, input_tokens: inputTokens, output_tokens: outputTokens },
    finalStatus: null,
  };
}
