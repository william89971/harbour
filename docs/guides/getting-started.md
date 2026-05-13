# Getting started

The first 30 minutes with Harbour. By the end of this you'll have a server running, a project, an agent, a recurring job, and a verified end-to-end polling loop.

Pick one of the three paths below — Docker is the easiest way to try it, plain `npm` is the easiest way to develop against it, and Harbour Agent layers the built-in CLI runner on top of either.

> If you want the *why* behind any of this — why polling, why no webhooks, why one run at a time per agent — read [Agents](../concepts/agents.md) and [Jobs and runs](../concepts/jobs-and-runs.md). This page is the *how*.

## Path A — Docker (recommended for trying it out)

Only requirement is Docker.

```bash
git clone https://github.com/geekforbrains/harbour.git
cd harbour
make run
```

`make run` is a thin wrapper over `docker compose up -d --build` plus a friendly post-run banner. It builds the image (~2 min on a cold cache, ~10s on a warm one), starts the container, and prints:

```
Harbour is running at http://localhost:3030
Data is persisted in ./data (DB, uploads, encryption key)
```

Visit [http://localhost:3030](http://localhost:3030) and sign up. The first user to register is just a normal user — Harbour has no separate "admin" role for the dashboard.

> All state lives in `./data` next to the repo. Back that directory up and you have a snapshot of everything (DB, uploads, encryption key, runner config). `make clean` deletes it; don't run that on a real install.

Useful side commands:

```bash
make logs     # follow the server logs
make down     # stop the container, keep ./data
make rebuild  # rebuild the image and restart (after pulling code changes)
```

Skip ahead to [First agent and first job](#first-agent-and-first-job).

## Path B — Without Docker (for development)

You'll need Node 20+ and a working `npm`.

```bash
git clone https://github.com/geekforbrains/harbour.git
cd harbour
npm install
npm run build
npm start
```

`npm start` runs `next start` on port 3000 by default. Visit [http://localhost:3000](http://localhost:3000) and sign up.

> Plain `npm start` uses port 3000; Docker uses 3030. They're not interchangeable URLs — make sure your bookmarks match the path you took.

State lives in `~/.harbour/` by default — DB at `~/.harbour/harbour.db`, uploads under `~/.harbour/uploads`, encryption key at `~/.harbour/encryption.key`. Override with `HARBOUR_HOME` if you want to keep installs separate.

For active development use `npm run dev -- -p 3001` instead. Avoid port 3000 — that's reserved for production in this repo's conventions.

## First agent and first job

Whichever path you took, the dashboard is now up. The setup below uses the **External** agent flow because it's path-agnostic — you can verify it with curl from your terminal. (Path C below swaps in a built-in CLI runner.)

> Replace `http://localhost:3030` with `http://localhost:3000` if you took Path B. The rest of the commands are identical.

### 1. Create an agent

In the dashboard:

1. **Agents → New Agent** in the top right.
2. Pick **External** ("Bring your own agent").
3. Name it — `Researcher` is fine.
4. **Create**.

The dialog flips to a confirmation panel showing an API key that looks like:

```
hbr_a0be210a2478ae2c38b8f2535747fea0...
```

Copy it now. The full key is shown once and never again. (You can rotate it later from the agent's detail page if you lose it.)

### 2. Create a job

On the agent's detail page, click **New Job**. Fill in:

- **Name** — `Daily check`
- **Trigger** — Schedule (the default)
- **Schedule** — pick `Every 5 minutes` from the picker
- **Instructions** — `Say hello.`
- **Create**

Behind the dialog this is `POST /api/agents/:id/jobs` with `{"name":"Daily check","schedule":"every 5 minutes","instructions":"Say hello"}`. You can also create jobs over the API directly — see the [admin guide](../../ADMIN_GUIDE.md#create-an-agent-job).

### 3. Verify the polling loop with curl

Set a couple of shell variables (use the API key you just copied and the agent ID from the URL on the agent's detail page):

```bash
export HARBOUR_URL=http://localhost:3030
export AGENT_ID=<paste-agent-id>
export KEY=<paste-api-key>
```

Peek for work without claiming it:

```bash
curl -s -H "Authorization: Bearer $KEY" \
  "$HARBOUR_URL/api/agents/$AGENT_ID/next?peek=true"
```

Right after creating the job you'll see one of two things, depending on whether the schedule has fired yet:

```json
{"available":false,"reason":"nothing_to_do"}
```

…or, once the next-run timestamp has passed but no run row has been created yet:

```json
{"available":true,"type":"scheduled","job_id":"...","job_name":"Daily check"}
```

…or, once a run row exists (after a manual trigger, or after the next non-peek call materialised one):

```json
{"available":true,"type":"scheduled_run","run_id":"...","job_name":"Daily check"}
```

> `?peek=true` is read-only — it does not claim the run, so you can call it as often as you like. The `available` field tells you whether the next non-peek call would return work.

To force a run instead of waiting for the schedule, hit the trigger endpoint from the dashboard's **Trigger now** button or via curl (any auth — session cookie, agent key, or admin key — works):

```bash
curl -s -H "Authorization: Bearer $KEY" -X POST "$HARBOUR_URL/api/jobs/<job-id>/trigger"
```

Now claim it (without `peek=true`):

```bash
curl -s -H "Authorization: Bearer $KEY" \
  "$HARBOUR_URL/api/agents/$AGENT_ID/next"
```

You'll get the full bundle: `run`, `job`, `docs`, `data`, `env`, `attachments`, and an `api` block with pre-resolved endpoints for this run. That's what your agent runtime parses to do work.

Finish the run cleanly so the next poll doesn't keep returning the same one:

```bash
RUN_ID=<run.id from the response above>
curl -s -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"status":"done"}' "$HARBOUR_URL/api/runs/$RUN_ID/status"
```

That's the entire agent contract. The full reference is at `GET /api/guide` (also in [`GUIDE.md`](../../GUIDE.md)).

## Path C — Harbour Agent (built-in CLI runner)

If you'd rather have Harbour run a local CLI tool (Claude Code, Codex, or Gemini CLI) for you, swap the External agent above for a Harbour Agent.

### 1. Pick a CLI

Make sure the CLI you want is on your PATH and authenticated:

- [Claude Code](https://claude.ai/claude-code) — `claude` in your shell
- [Codex](https://github.com/openai/codex) — `codex`
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) — `gemini`

### 2. Create the agent

In the dashboard:

1. **Agents → New Agent → Harbour Agent**.
2. Pick the CLI tool.
3. Name it, pick a default model and (if relevant) thinking/effort level.
4. Leave **Run on a different machine** unchecked — this section assumes the runner is on the same box as the server.
5. **Create**.

Creating a non-remote Harbour Agent writes an entry to `~/.harbour/runners.json` automatically (see [`src/app/api/agents/route.ts`](../../src/app/api/agents/route.ts)). That's how the runner knows which agents to poll for.

Add a job exactly like the External flow — schedule, instructions, **Create**.

### 3. Manual poll cycle

Before scheduling polling, run one cycle by hand to confirm the CLI is hooked up:

```bash
npm run harbour -- agent run
```

Output looks like:

```
[Researcher] Polling...
[Researcher] Nothing to do.
```

…or, if a job is ready:

```
[Researcher] Polling...
[Researcher] Starting run <id> (Daily check)
```

(`Resuming run` instead of `Starting run` if the runner is picking up a killed run via comment.)

`harbour agent list` shows everything currently configured:

```
NAME           CLI      MODEL    THINKING   URL
Researcher     claude   opus     —          http://localhost:3000
```

### 4. Schedule polling

```bash
npm run harbour -- agent install
```

`installRunner()` in [`bin/lib/install.mjs`](../../bin/lib/install.mjs) detects the host OS and picks the right backend:

- **macOS:** writes `~/Library/LaunchAgents/com.harbour.agent-runner.plist` with `StartInterval=60` and `launchctl load`s it. Logs at `~/.harbour/runner.log` and `~/.harbour/runner.err.log`. Tail with `tail -f ~/.harbour/runner.log`.
- **Linux:** writes a user-level systemd `.service` + `.timer` to `~/.config/systemd/user/` and enables the timer (60-second `OnUnitActiveSec`, 10-second `OnBootSec`, `Persistent=true` for missed runs). View logs with `journalctl --user -u harbour-agent-runner.service -f`. On a headless server, run `loginctl enable-linger $USER` so user services persist across logouts.
- **Other platforms** (Windows, BSD): the install command exits with a clear error. Run `npm run harbour -- agent run` from cron / a supervisor / whatever you've got.

To check the install state: `npm run harbour -- agent status`. To stop polling: `npm run harbour -- agent uninstall` (removes the units and disables them; macOS removes the plist).

To poll faster than every 60 seconds, set the cadence **before installing**:

```bash
npm run harbour -- agent interval 15    # 5..3600 seconds
npm run harbour -- agent install
```

Or change it in the dashboard at **Settings → Runner polling interval**. The value lives in `~/.harbour/runner-config.json` per host; changes take effect on the next `agent install`.

## Now what?

You have a working harbour with a working agent. From here:

- [Jobs and runs](../concepts/jobs-and-runs.md) — the polling ladder, the lifecycle, how retries work.
- [Agents](../concepts/agents.md) — the harbour-vs-external split and per-agent settings.
- [Shared context](../concepts/shared-context.md) — docs, databases, env vars, and how pinning auto-attaches them.
- [Running a runner on a different machine](run-on-different-machine.md) — for iOS/Xcode boxes, GPU workstations, on-prem repos.
