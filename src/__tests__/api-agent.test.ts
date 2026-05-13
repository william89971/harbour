/**
 * API-agent runtime end-to-end.
 *
 * Uses an in-process HTTP server pretending to be both:
 *   - the OpenAI-compatible chat/completions endpoint (the "model"), and
 *   - the Harbour API (so we can verify the tool dispatcher hits the
 *     right paths).
 *
 * The model produces a scripted sequence: first turn requests a
 * post_activity tool call; second turn calls finish with a final summary.
 */
import { describe, it, expect } from "vitest";
import http from "http";
import { AddressInfo } from "net";
import { runApiAgent, decideApiFinish } from "../../bin/lib/api-agent.mjs";

function startServer(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void): Promise<{ url: string; close: () => Promise<void>; calls: { method: string; path: string; body: unknown }[] }> {
  const calls: { method: string; path: string; body: unknown }[] = [];
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", chunk => { raw += chunk; });
      req.on("end", () => {
        let parsed: unknown = raw;
        if (raw && req.headers["content-type"]?.includes("json")) {
          try { parsed = JSON.parse(raw); } catch { /* leave as string */ }
        }
        calls.push({ method: req.method || "GET", path: req.url || "/", body: parsed });
        handler(req, raw, res);
      });
    });
    server.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise(r => server.close(() => r())),
        calls,
      });
    });
  });
}

describe("api-agent runtime", () => {
  it("drives a tool-call loop and returns the final assistant content", async () => {
    let turn = 0;
    const server = await startServer((req, _body, res) => {
      if (req.url?.endsWith("/chat/completions")) {
        res.setHeader("Content-Type", "application/json");
        if (turn === 0) {
          turn++;
          res.end(JSON.stringify({
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call_1",
                  function: { name: "post_activity", arguments: JSON.stringify({ content: "working on it" }) },
                }],
              },
            }],
            usage: { prompt_tokens: 100, completion_tokens: 20 },
          }));
        } else {
          res.end(JSON.stringify({
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call_2",
                  function: { name: "finish", arguments: JSON.stringify({ content: "all done", status: "done" }) },
                }],
              },
            }],
            usage: { prompt_tokens: 80, completion_tokens: 10 },
          }));
        }
      } else if (req.url?.includes("/api/runs/") && req.url?.endsWith("/activity")) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.statusCode = 404;
        res.end("not found");
      }
    });

    const lines: string[] = [];
    const result = await runApiAgent({
      prompt: "do the thing",
      apiBaseUrl: server.url,
      apiKey: "model-key",
      model: "deepseek-chat",
      toolPermissions: { post_activity: true, update_status: true, read_docs: false, write_docs: false, read_databases: false, write_databases: false, read_env_vars: false, create_runs: false, create_handoffs: false, use_shell: false },
      harbour: { url: server.url, apiKey: "hbr_test", agentId: "a-1", runId: "r-1", jobId: "j-1" },
      env: {},
      onLine: (l: string) => lines.push(l),
      maxIterations: 5,
    });

    expect(result.content).toBe("all done");
    expect(result.finalStatus).toBe("done");
    expect(result.usage?.input_tokens).toBe(180);
    expect(result.usage?.output_tokens).toBe(30);

    // Two chat/completions calls + one activity POST
    const completionCalls = server.calls.filter(c => c.path.endsWith("/chat/completions"));
    expect(completionCalls.length).toBe(2);
    const activityCalls = server.calls.filter(c => c.method === "POST" && c.path.includes("/activity"));
    expect(activityCalls.length).toBe(1);
    expect((activityCalls[0].body as { content: string }).content).toBe("working on it");

    // Stream events: at least one info + two tool_start/tool_end pairs.
    const events = lines.map(l => JSON.parse(l));
    expect(events.find((e: { event_type: string }) => e.event_type === "info")).toBeTruthy();
    expect(events.filter((e: { event_type: string }) => e.event_type === "tool_start").length).toBe(2);
    expect(events.filter((e: { event_type: string }) => e.event_type === "tool_end").length).toBe(2);

    await server.close();
  });

  it("denies tool calls that aren't permitted and reports them as tool results", async () => {
    let turn = 0;
    const server = await startServer((req, _body, res) => {
      if (req.url?.endsWith("/chat/completions")) {
        res.setHeader("Content-Type", "application/json");
        if (turn === 0) {
          turn++;
          // Model tries to call write_doc despite it being disallowed.
          res.end(JSON.stringify({
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call_1",
                  function: { name: "write_doc", arguments: JSON.stringify({ title: "x", content: "y" }) },
                }],
              },
            }],
            usage: {},
          }));
        } else {
          res.end(JSON.stringify({
            choices: [{
              message: { role: "assistant", content: null, tool_calls: [{
                id: "call_2",
                function: { name: "finish", arguments: JSON.stringify({ content: "couldn't write" }) },
              }] },
            }],
            usage: {},
          }));
        }
      } else {
        res.statusCode = 404; res.end("not found");
      }
    });

    const lines: string[] = [];
    const result = await runApiAgent({
      prompt: "try to write",
      apiBaseUrl: server.url,
      apiKey: "model-key",
      model: "deepseek-chat",
      toolPermissions: { read_docs: false, write_docs: false, read_databases: false, write_databases: false, read_env_vars: false, create_runs: false, create_handoffs: false, post_activity: false, update_status: false, use_shell: false },
      harbour: { url: server.url, apiKey: "hbr_test", agentId: "a-1", runId: "r-1", jobId: "j-1" },
      env: {},
      onLine: (l: string) => lines.push(l),
      maxIterations: 5,
    });
    expect(result.content).toBe("couldn't write");
    const events = lines.map(l => JSON.parse(l));
    const denied = events.find((e: { event_type: string; content: string }) =>
      e.event_type === "tool_end" && e.content.includes("not permitted"));
    expect(denied).toBeTruthy();
    // No Harbour-side writes should have happened.
    expect(server.calls.find(c => c.path.endsWith("/api/docs"))).toBeUndefined();
    await server.close();
  });
});

describe("decideApiFinish (tool-permission-driven finish handling)", () => {
  const tp = (overrides: Partial<Record<string, boolean>> = {}) => ({
    read_docs: true, write_docs: true,
    read_databases: true, write_databases: true,
    read_env_vars: true,
    create_runs: true, create_handoffs: true,
    post_activity: true, update_status: true,
    use_shell: false,
    ...overrides,
  });

  it("posts content + status when both permissions are on", () => {
    const d = decideApiFinish({
      apiResult: { content: "done!", finalStatus: "done" },
      toolPermissions: tp(),
    });
    expect(d.postContent).toBe("done!");
    expect(d.putStatus).toBe("done");
    expect(d.noteContent).toBeNull();
    expect(d.reason).toBe("ok");
  });

  it("posts content + a system note when status update is denied", () => {
    const d = decideApiFinish({
      apiResult: { content: "done!", finalStatus: "done" },
      toolPermissions: tp({ update_status: false }),
    });
    expect(d.postContent).toBe("done!");
    expect(d.putStatus).toBeNull();
    expect(d.noteContent).toMatch(/update_status tool permission is off/);
    expect(d.reason).toBe("skipped-status-no-permission");
  });

  it("drops the content but updates status when post_activity is denied", () => {
    const d = decideApiFinish({
      apiResult: { content: "done!", finalStatus: "done" },
      toolPermissions: tp({ post_activity: false }),
    });
    expect(d.postContent).toBeNull();
    expect(d.putStatus).toBe("done");
    expect(d.noteContent).toBeNull();
  });

  it("does nothing when both post_activity and update_status are denied", () => {
    const d = decideApiFinish({
      apiResult: { content: "done!", finalStatus: "done" },
      toolPermissions: tp({ post_activity: false, update_status: false }),
    });
    expect(d.postContent).toBeNull();
    expect(d.putStatus).toBeNull();
    // No note either — there's nowhere to post it.
    expect(d.noteContent).toBeNull();
    expect(d.reason).toBe("skipped-status-no-permission");
  });

  it("treats a missing toolPermissions object as all-on (remote-runner compat)", () => {
    const d = decideApiFinish({
      apiResult: { content: "done!", finalStatus: "done" },
      toolPermissions: null,
    });
    expect(d.postContent).toBe("done!");
    expect(d.putStatus).toBe("done");
    expect(d.reason).toBe("ok");
  });

  it("treats undefined toolPermissions as all-on", () => {
    const d = decideApiFinish({
      apiResult: { content: "done!", finalStatus: "done" },
      toolPermissions: undefined,
    });
    expect(d.postContent).toBe("done!");
    expect(d.putStatus).toBe("done");
  });

  it("flags empty agent results", () => {
    const d = decideApiFinish({
      apiResult: { content: "", finalStatus: null },
      toolPermissions: tp(),
    });
    expect(d.postContent).toBeNull();
    expect(d.putStatus).toBeNull();
    expect(d.reason).toBe("agent-finished-empty");
  });
});
