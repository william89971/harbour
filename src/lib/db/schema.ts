import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { normalizeSchedule } from "../schedule";
import { encrypt } from "../encryption";
import { dbPath, harbourHome, ensureDir } from "../paths";
import type { DbAdapter } from "./adapter";
import { createSqliteAdapter, wrapSqliteDb, SqliteAdapter } from "./adapter-sqlite";
import { createPostgresAdapter, PostgresAdapter } from "./adapter-postgres";
import { initializePostgresSchema } from "./schema-postgres";

// Legacy sync handle — every existing DB module still uses this. The async
// adapter layer below is the future direction; both are kept side-by-side
// during the Postgres migration so SQLite paths keep working unchanged while
// new code can opt into the async adapter.
let _db: Database.Database | null = null;
let _adapter: DbAdapter | null = null;
let _initPromise: Promise<DbAdapter> | null = null;

/**
 * One-time migration: if a legacy ./harbour.db exists in the cwd and the
 * default ~/.harbour/harbour.db doesn't, copy it (plus its WAL sidecars)
 * into the new home so the user can back up a single directory.
 *
 * Skipped when HARBOUR_DB_PATH is explicitly set.
 */
function migrateLegacyDbIfNeeded() {
  if (process.env.HARBOUR_DB_PATH) return;
  const target = dbPath();
  if (fs.existsSync(target)) return;

  const legacy = path.join(process.cwd(), "harbour.db");
  if (!fs.existsSync(legacy)) return;
  if (path.resolve(legacy) === path.resolve(target)) return;

  ensureDir(path.dirname(target));
  for (const ext of ["", "-shm", "-wal"]) {
    const src = legacy + ext;
    if (fs.existsSync(src)) fs.copyFileSync(src, target + ext);
  }
  console.log(`[harbour] Migrated ${legacy} → ${target} (original preserved)`);
}

function isPostgresUrl(url: string | undefined): boolean {
  return !!url && /^postgres(ql)?:\/\//i.test(url);
}

/** Legacy sync handle. Used by every existing DB module today. Continues to
 *  open the same SQLite file with WAL + foreign_keys and run inline migrations.
 *  Throws if DATABASE_URL is set to a Postgres URL — those callers must use
 *  the new async getDbAsync()/getAdapter() API instead. */
export function getDb(): Database.Database {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (isPostgresUrl(url)) {
    throw new Error(
      "Sync getDb() called while DATABASE_URL is set to Postgres. The caller " +
      "needs to be migrated to use the async adapter (getDbAsync()). " +
      "Postgres support is rolling out module-by-module.",
    );
  }
  ensureDir(harbourHome());
  migrateLegacyDbIfNeeded();
  _db = new Database(dbPath());
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  initializeSchema(_db);
  return _db;
}

/** Async adapter handle. Returns a `DbAdapter` that abstracts over both
 *  better-sqlite3 (when DATABASE_URL is unset) and node-postgres (when set).
 *  New code should prefer this; legacy sync code keeps using `getDb()`. */
export async function getDbAsync(): Promise<DbAdapter> {
  if (_adapter) return _adapter;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const url = process.env.DATABASE_URL;
    if (isPostgresUrl(url)) {
      const adapter = createPostgresAdapter(url!);
      await initializePostgresSchema(adapter);
      _adapter = adapter;
      return adapter;
    }
    // Reuse the sync SQLite handle so both APIs share one file/connection.
    const raw = getDb();
    _adapter = wrapSqliteDb(raw);
    return _adapter;
  })();

  return _initPromise;
}

/** Test helper: swap in a raw better-sqlite3 Database (legacy path) or an
 *  already-built DbAdapter (new path). Both handles are kept in sync. */
export function setDb(adapterOrDb: DbAdapter | Database.Database) {
  if ((adapterOrDb as DbAdapter).dialect) {
    _adapter = adapterOrDb as DbAdapter;
    // Best-effort: surface the underlying better-sqlite3 instance to the sync
    // handle so legacy code paths still work in tests.
    const inner = (adapterOrDb as SqliteAdapter).db;
    if (inner) _db = inner;
    _initPromise = Promise.resolve(_adapter);
  } else {
    _db = adapterOrDb as Database.Database;
    _adapter = wrapSqliteDb(_db);
    _initPromise = Promise.resolve(_adapter);
  }
}

export function resetDb() {
  _db = null;
  _adapter = null;
  _initPromise = null;
}

/** Re-exported so existing tests that do `initializeSchema(db)` keep working
 *  against a raw better-sqlite3 instance. The Postgres path uses
 *  `initializePostgresSchema` instead — see schema-postgres.ts. */
export function initializeSchema(db: Database.Database) {
  db.exec(`
    -- Users: human accounts for dashboard auth
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin'
        CHECK(role IN ('admin','operator','viewer')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Agents: top-level entity, each has jobs/docs/data
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      api_key_hash TEXT NOT NULL,
      max_concurrent_runs INTEGER NOT NULL DEFAULT 1 CHECK(max_concurrent_runs BETWEEN 1 AND 10),
      shell_command TEXT,
      shell_cwd TEXT,
      permission_mode TEXT NOT NULL DEFAULT 'unrestricted'
        CHECK(permission_mode IN ('safe','custom','unrestricted')),
      api_base_url TEXT,
      api_key_env TEXT,
      can_read_docs INTEGER NOT NULL DEFAULT 1,
      can_write_docs INTEGER NOT NULL DEFAULT 1,
      can_read_databases INTEGER NOT NULL DEFAULT 1,
      can_write_databases INTEGER NOT NULL DEFAULT 1,
      can_read_env_vars INTEGER NOT NULL DEFAULT 1,
      can_create_runs INTEGER NOT NULL DEFAULT 1,
      can_create_handoffs INTEGER NOT NULL DEFAULT 1,
      can_post_activity INTEGER NOT NULL DEFAULT 1,
      can_update_status INTEGER NOT NULL DEFAULT 1,
      can_use_shell INTEGER NOT NULL DEFAULT 1,
      last_polled_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Teams: groupings of multiple agents for parallel multi-role work
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Team membership with per-team role assignment
    CREATE TABLE IF NOT EXISTS team_agents (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'custom' CHECK(role IN ('researcher','builder','reviewer','debugger','custom')),
      custom_role TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (team_id, agent_id)
    );

    -- Jobs: recurring responsibilities assigned to an agent or team
    -- agent_id is nullable to support workflow-only jobs and team-assigned jobs
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
      preferred_role TEXT,
      role_fallback TEXT NOT NULL DEFAULT 'any' CHECK(role_fallback IN ('any','wait')),
      name TEXT NOT NULL,
      description TEXT,
      instructions TEXT,
      schedule TEXT NOT NULL,
      workflow_command TEXT,
      workflow_only INTEGER NOT NULL DEFAULT 0,

      timeout_minutes INTEGER NOT NULL DEFAULT 30,
      one_off INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      next_run_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Runs: single execution of a job
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('scheduled','running','waiting','pending','done','failed','skipped','killed')),
      scheduled_for INTEGER,
      claimed_at INTEGER,
      completed_at INTEGER,
      kill_requested_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Run activity: ordered log of messages on a run
    CREATE TABLE IF NOT EXISTS run_activity (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      author_type TEXT NOT NULL CHECK(author_type IN ('agent','user','system')),
      author_id TEXT,
      author_name TEXT,
      content TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Docs: top-level markdown documents, linked to jobs via job_docs
    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_by_type TEXT CHECK(created_by_type IN ('user','agent')),
      created_by_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS doc_revisions (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      author_type TEXT CHECK(author_type IN ('user','agent')),
      author_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Job-doc linking: which docs a job references
    CREATE TABLE IF NOT EXISTS job_docs (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      PRIMARY KEY (job_id, doc_id)
    );

    -- Databases: agent-managed SQLite tables (app-level, not agent-owned)
    CREATE TABLE IF NOT EXISTS databases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      table_name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Database migration history
    CREATE TABLE IF NOT EXISTS database_migrations (
      id TEXT PRIMARY KEY,
      database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      description TEXT,
      sql TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Job-database linking: which databases a job references
    CREATE TABLE IF NOT EXISTS job_databases (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
      PRIMARY KEY (job_id, database_id)
    );

    -- System settings: key-value store
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Environment variables: encrypted key-value pairs injected at runtime
    CREATE TABLE IF NOT EXISTS env_vars (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      encrypted_value TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Job-env linking: which env vars a job references
    CREATE TABLE IF NOT EXISTS job_env_vars (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      env_var_id TEXT NOT NULL REFERENCES env_vars(id) ON DELETE CASCADE,
      PRIMARY KEY (job_id, env_var_id)
    );

    -- Run attachments: files uploaded to a run, or URL embeds (Loom/YouTube/Vimeo)
    CREATE TABLE IF NOT EXISTS run_attachments (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      activity_id TEXT REFERENCES run_activity(id) ON DELETE SET NULL,
      kind TEXT NOT NULL CHECK(kind IN ('file','embed')),
      filename TEXT,
      storage_path TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      url TEXT,
      embed_provider TEXT,
      title TEXT,
      uploaded_by_type TEXT CHECK(uploaded_by_type IN ('user','agent')),
      uploaded_by_id TEXT,
      uploaded_by_name TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Run output: raw streaming events from CLI agent execution
    CREATE TABLE IF NOT EXISTS run_output (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      content TEXT,
      tool_name TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Run costs: token usage and estimated USD cost per run (one row per run, idempotent)
    CREATE TABLE IF NOT EXISTS run_costs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
      provider TEXT,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      estimated_cost_usd REAL,
      pricing_known INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Run feedback: per-run useful/not_useful/neutral ratings from operators.
    -- One row per (run, user) — UPSERT semantics for re-rating.
    CREATE TABLE IF NOT EXISTS run_feedback (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      rating TEXT NOT NULL
        CHECK(rating IN ('useful','not_useful','neutral')),
      comment TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(run_id, created_by_user_id)
    );

    -- Projects: optional organizational grouping (view layer only)
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS project_agents (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS project_jobs (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, job_id)
    );

    CREATE TABLE IF NOT EXISTS project_docs (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, doc_id)
    );

    CREATE TABLE IF NOT EXISTS project_env_vars (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      env_var_id TEXT NOT NULL REFERENCES env_vars(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, env_var_id)
    );

    CREATE TABLE IF NOT EXISTS project_databases (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, database_id)
    );

    -- Video processing: tracks processing state for uploaded video attachments
    CREATE TABLE IF NOT EXISTS attachment_processing (
      id TEXT PRIMARY KEY,
      attachment_id TEXT NOT NULL UNIQUE REFERENCES run_attachments(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','processing','done','failed')),
      transcript_path TEXT,
      screenshots_dir TEXT,
      screenshot_count INTEGER NOT NULL DEFAULT 0,
      screenshot_interval INTEGER,
      duration_seconds REAL,
      error TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Captain: real-time chat conversations with CLI tools
    CREATE TABLE IF NOT EXISTS captain_conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      cli TEXT NOT NULL,
      model TEXT,
      thinking TEXT,
      session_id TEXT,
      cwd TEXT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS captain_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES captain_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS captain_output (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES captain_conversations(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES captain_messages(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      content TEXT,
      tool_name TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Run handoffs: one run hands work to another agent or team. Snapshots
    -- keep the handoff legible even if the source run is later deleted.
    CREATE TABLE IF NOT EXISTS run_handoffs (
      id TEXT PRIMARY KEY,
      source_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      source_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      target_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      target_team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
      target_role TEXT,
      target_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
      target_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      source_run_name_snapshot TEXT,
      source_agent_name_snapshot TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','accepted','completed','cancelled')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Workflows ("Company OS"): top-level pipeline definitions that orchestrate
    -- existing jobs + runs. A workflow has ordered steps; starting a workflow
    -- creates a workflow_run, which spawns step_runs that point at normal
    -- runs.id. The advancement hook lives in updateRunStatusAsync(Async).
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      department TEXT,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft','active','paused','archived')),
      autonomy_level TEXT NOT NULL DEFAULT 'supervised'
        CHECK(autonomy_level IN ('manual','supervised','autonomous')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS workflow_steps (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      instructions TEXT NOT NULL DEFAULT '',
      assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      assigned_team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
      preferred_role TEXT,
      role_fallback TEXT NOT NULL DEFAULT 'any'
        CHECK(role_fallback IN ('any','wait')),
      requires_human_approval INTEGER NOT NULL DEFAULT 0,
      approval_type TEXT NOT NULL DEFAULT 'none'
        CHECK(approval_type IN ('none','before_step','after_step')),
      risky INTEGER NOT NULL DEFAULT 0,
      timeout_minutes INTEGER NOT NULL DEFAULT 30,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK(status IN ('running','waiting_for_approval','done','failed','rejected')),
      current_step_id TEXT REFERENCES workflow_steps(id) ON DELETE SET NULL,
      started_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      input_payload TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS workflow_step_runs (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      step_id TEXT NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','waiting_approval_before','running','waiting_approval_after','done','failed','skipped','rejected','needs_changes')),
      approval_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      approval_at INTEGER,
      approval_comment TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS workflow_run_activity (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      step_run_id TEXT REFERENCES workflow_step_runs(id) ON DELETE SET NULL,
      author_type TEXT NOT NULL,
      author_id TEXT,
      author_name TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('comment','approve','reject','request_changes','status','start','finish')),
      content TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Autonomy policies: declarative rules ("send_email always needs approval",
    -- "deploy_code never auto-runs in Engineering") applied uniformly across
    -- workflow steps, agent tool calls, and run cost ceilings. Composes with
    -- the existing per-agent permission/tool layer rather than replacing it.
    CREATE TABLE IF NOT EXISTS autonomy_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      scope_type TEXT NOT NULL
        CHECK(scope_type IN ('global','department','workflow','agent','team')),
      scope_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS policy_rules (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES autonomy_policies(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      risk_level TEXT NOT NULL
        CHECK(risk_level IN ('low','medium','high','critical')),
      require_approval INTEGER NOT NULL DEFAULT 0,
      max_cost_usd REAL,
      allowed_roles TEXT,
      approval_roles TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(policy_id, action_type)
    );

    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL
        CHECK(source_type IN ('run','workflow_run','workflow_step','tool_call','cost')),
      source_id TEXT NOT NULL,
      requested_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      action_type TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      reason TEXT,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','approved','rejected','expired')),
      approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      approval_comment TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at INTEGER
    );

    -- Company OS: durable direction (goals), outstanding work (tasks), history (decisions).
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','paused','completed','archived')),
      priority TEXT NOT NULL DEFAULT 'medium'
        CHECK(priority IN ('low','medium','high')),
      target_date INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'todo'
        CHECK(status IN ('todo','doing','blocked','done','archived')),
      priority TEXT NOT NULL DEFAULT 'medium'
        CHECK(priority IN ('low','medium','high')),
      owner_type TEXT NOT NULL DEFAULT 'none'
        CHECK(owner_type IN ('user','agent','none')),
      owner_id TEXT,
      goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
      due_date INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      decision TEXT NOT NULL,
      rationale TEXT,
      consequences TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Growth Outreach Loop: prospects, accounts, drafted outreach.
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      website TEXT,
      industry TEXT,
      status TEXT NOT NULL DEFAULT 'prospect'
        CHECK(status IN ('prospect','customer','partner','archived')),
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
      title TEXT,
      source TEXT,
      status TEXT NOT NULL DEFAULT 'new'
        CHECK(status IN ('new','researched','drafted','contacted','replied','archived')),
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS outreach_drafts (
      id TEXT PRIMARY KEY,
      contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
      company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft','pending_approval','approved','sent','rejected','archived')),
      created_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      approval_request_id TEXT REFERENCES approval_requests(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_attachment_processing_attachment ON attachment_processing(attachment_id);
    CREATE INDEX IF NOT EXISTS idx_attachment_processing_run ON attachment_processing(run_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_agent ON jobs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id);
    CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS idx_run_activity_run ON run_activity(run_id);
    CREATE INDEX IF NOT EXISTS idx_run_output_run ON run_output(run_id);
    CREATE INDEX IF NOT EXISTS idx_run_attachments_run ON run_attachments(run_id);
    CREATE INDEX IF NOT EXISTS idx_run_attachments_activity ON run_attachments(activity_id);
    CREATE INDEX IF NOT EXISTS idx_run_costs_run ON run_costs(run_id);
    CREATE INDEX IF NOT EXISTS idx_run_feedback_run ON run_feedback(run_id);
    CREATE INDEX IF NOT EXISTS idx_run_feedback_rating ON run_feedback(rating);
    CREATE INDEX IF NOT EXISTS idx_doc_revisions_doc ON doc_revisions(doc_id);
    CREATE INDEX IF NOT EXISTS idx_database_migrations_db ON database_migrations(database_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_schedule ON jobs(agent_id, active, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_run_activity_run_time ON run_activity(run_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_captain_conversations_user ON captain_conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_captain_messages_conversation ON captain_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_captain_output_conversation ON captain_output(conversation_id);

    CREATE INDEX IF NOT EXISTS idx_team_agents_team ON team_agents(team_id);
    CREATE INDEX IF NOT EXISTS idx_team_agents_agent ON team_agents(agent_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_team ON jobs(team_id);

    CREATE INDEX IF NOT EXISTS idx_run_handoffs_source ON run_handoffs(source_run_id);
    CREATE INDEX IF NOT EXISTS idx_run_handoffs_target_run ON run_handoffs(target_run_id);
    CREATE INDEX IF NOT EXISTS idx_run_handoffs_target_job ON run_handoffs(target_job_id);

    CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow ON workflow_steps(workflow_id, step_order);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
    CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_workflow_run ON workflow_step_runs(workflow_run_id, step_order);
    CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_run ON workflow_step_runs(run_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_run_activity_run ON workflow_run_activity(workflow_run_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_autonomy_policies_scope ON autonomy_policies(scope_type, scope_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_policy_rules_policy ON policy_rules(policy_id);
    CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_approval_requests_source ON approval_requests(source_type, source_id);

    CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
    CREATE INDEX IF NOT EXISTS idx_decisions_created ON decisions(created_at);

    CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
    CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);
    CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach_drafts(status);
    CREATE INDEX IF NOT EXISTS idx_outreach_contact ON outreach_drafts(contact_id);
  `);

  // Migrations: drop agent_id from docs (now top-level)
  const docCols = db.prepare(`PRAGMA table_info(docs)`).all() as { name: string }[];
  if (docCols.some(c => c.name === "agent_id")) {
    db.exec(`DROP INDEX IF EXISTS idx_docs_agent`);
    db.exec(`ALTER TABLE docs DROP COLUMN agent_id`);
  }

  // Migrations: add 'pending' to runs status CHECK constraint
  const runCheck = db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'runs'`).get() as { sql?: string } | undefined;
  if (runCheck?.sql && !runCheck.sql.includes("pending")) {
    db.exec(`
      DROP TABLE IF EXISTS runs_new;
      CREATE TABLE runs_new (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','waiting','pending','done','failed','skipped')),
        claimed_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO runs_new SELECT * FROM runs;
      DROP TABLE runs;
      ALTER TABLE runs_new RENAME TO runs;
      CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id);
      CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    `);
  }

  // Migrations: add one_off and timeout_minutes columns to jobs
  const jobCols = db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[];
  if (!jobCols.some(c => c.name === "one_off")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN one_off INTEGER NOT NULL DEFAULT 0`);
  }
  if (!jobCols.some(c => c.name === "timeout_minutes")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN timeout_minutes INTEGER NOT NULL DEFAULT 30`);
  }

  // Migrations: add 'scheduled' status and scheduled_for column to runs
  const runCheck2 = db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'runs'`).get() as { sql?: string } | undefined;
  if (runCheck2?.sql && !runCheck2.sql.includes("scheduled")) {
    db.exec(`
      DROP TABLE IF EXISTS runs_new;
      CREATE TABLE runs_new (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('scheduled','running','waiting','pending','done','failed','skipped')),
        scheduled_for INTEGER,
        claimed_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO runs_new (id, job_id, agent_id, status, claimed_at, completed_at, created_at, updated_at)
        SELECT id, job_id, agent_id, status, claimed_at, completed_at, created_at, updated_at FROM runs;
      DROP TABLE runs;
      ALTER TABLE runs_new RENAME TO runs;
      CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id);
      CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    `);
  }

  // Migrations: add 'killed' status and kill_requested_at column to runs
  const runCheck3 = db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'runs'`).get() as { sql?: string } | undefined;
  if (runCheck3?.sql && !runCheck3.sql.includes("killed")) {
    db.exec(`
      DROP TABLE IF EXISTS runs_new;
      CREATE TABLE runs_new (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('scheduled','running','waiting','pending','done','failed','skipped','killed')),
        scheduled_for INTEGER,
        claimed_at INTEGER,
        completed_at INTEGER,
        kill_requested_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO runs_new (id, job_id, agent_id, status, scheduled_for, claimed_at, completed_at, created_at, updated_at)
        SELECT id, job_id, agent_id, status, scheduled_for, claimed_at, completed_at, created_at, updated_at FROM runs;
      DROP TABLE runs;
      ALTER TABLE runs_new RENAME TO runs;
      CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id);
      CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    `);
  }

  // Migrations: normalize non-JSON schedule strings to canonical JSON
  const nonJsonSchedules = db.prepare(
    `SELECT id, schedule FROM jobs WHERE schedule NOT LIKE '{%'`
  ).all() as { id: string; schedule: string }[];
  if (nonJsonSchedules.length > 0) {
    const update = db.prepare(`UPDATE jobs SET schedule = ? WHERE id = ?`);
    for (const row of nonJsonSchedules) {
      const normalized = normalizeSchedule(row.schedule);
      if (normalized) update.run(normalized, row.id);
    }
  }

  // Migrations: add type, cli, model columns to agents table for harbour agents
  const agentCols = db.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[];
  if (!agentCols.some(c => c.name === "type")) {
    db.exec(`ALTER TABLE agents ADD COLUMN type TEXT NOT NULL DEFAULT 'external'`);
  }
  if (!agentCols.some(c => c.name === "cli")) {
    db.exec(`ALTER TABLE agents ADD COLUMN cli TEXT`);
  }
  if (!agentCols.some(c => c.name === "model")) {
    db.exec(`ALTER TABLE agents ADD COLUMN model TEXT`);
  }
  if (!agentCols.some(c => c.name === "thinking")) {
    db.exec(`ALTER TABLE agents ADD COLUMN thinking TEXT`);
  }
  if (!agentCols.some(c => c.name === "remote")) {
    db.exec(`ALTER TABLE agents ADD COLUMN remote INTEGER NOT NULL DEFAULT 0`);
  }
  if (!agentCols.some(c => c.name === "eager")) {
    db.exec(`ALTER TABLE agents ADD COLUMN eager INTEGER NOT NULL DEFAULT 0`);
  }

  // Migrations: add pinned column to docs table
  const docCols2 = db.prepare(`PRAGMA table_info(docs)`).all() as { name: string }[];
  if (!docCols2.some(c => c.name === "pinned")) {
    db.exec(`ALTER TABLE docs ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`);
  }

  // Migrations: add model and thinking columns to jobs table
  const jobCols2 = db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[];
  if (!jobCols2.some(c => c.name === "model")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN model TEXT`);
  }
  if (!jobCols2.some(c => c.name === "thinking")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN thinking TEXT`);
  }

  // Migrations: admin API keys table
  const adminKeyCols = db.prepare(`PRAGMA table_info(admin_api_keys)`).all() as { name: string }[];
  if (adminKeyCols.length === 0) {
    db.exec(`
      CREATE TABLE admin_api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        api_key_hash TEXT NOT NULL UNIQUE,
        created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_used_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
  }

  // Migrations: add extra_instructions, session_id, session_cwd columns to runs
  const runCols = db.prepare(`PRAGMA table_info(runs)`).all() as { name: string }[];
  if (!runCols.some(c => c.name === "extra_instructions")) {
    db.exec(`ALTER TABLE runs ADD COLUMN extra_instructions TEXT`);
  }
  if (!runCols.some(c => c.name === "session_id")) {
    db.exec(`ALTER TABLE runs ADD COLUMN session_id TEXT`);
  }
  if (!runCols.some(c => c.name === "session_cwd")) {
    db.exec(`ALTER TABLE runs ADD COLUMN session_cwd TEXT`);
  }

  // Migrations: rename check_command → workflow_command, add workflow_only
  const jobCols3 = db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[];
  if (jobCols3.some(c => c.name === "check_command")) {
    db.exec(`ALTER TABLE jobs RENAME COLUMN check_command TO workflow_command`);
  }
  if (!jobCols3.some(c => c.name === "workflow_only")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN workflow_only INTEGER NOT NULL DEFAULT 0`);
  }

  // Migration: make agent_id nullable on jobs (for workflow-only jobs without an agent)
  const jobAgentCol = (db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string; notnull: number }[])
    .find(c => c.name === "agent_id");
  if (jobAgentCol?.notnull === 1) {
    db.exec(`
      CREATE TABLE jobs_new (
        id TEXT PRIMARY KEY,
        agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        instructions TEXT,
        schedule TEXT NOT NULL,
        workflow_command TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        last_run_at INTEGER,
        next_run_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        one_off INTEGER NOT NULL DEFAULT 0,
        timeout_minutes INTEGER NOT NULL DEFAULT 30,
        model TEXT,
        thinking TEXT,
        workflow_only INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO jobs_new SELECT * FROM jobs;
      DROP TABLE jobs;
      ALTER TABLE jobs_new RENAME TO jobs;
      CREATE INDEX IF NOT EXISTS idx_jobs_agent ON jobs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_schedule ON jobs(agent_id, active, next_run_at);
    `);
  }

  // Migration: make agent_id nullable on runs (for agentless workflow runs)
  const runAgentCol = (db.prepare(`PRAGMA table_info(runs)`).all() as { name: string; notnull: number }[])
    .find(c => c.name === "agent_id");
  if (runAgentCol?.notnull === 1) {
    db.exec(`
      CREATE TABLE runs_new (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('scheduled','running','waiting','pending','done','failed','skipped','killed')),
        scheduled_for INTEGER,
        claimed_at INTEGER,
        completed_at INTEGER,
        kill_requested_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        extra_instructions TEXT,
        session_id TEXT,
        session_cwd TEXT
      );
      INSERT INTO runs_new SELECT * FROM runs;
      DROP TABLE runs;
      ALTER TABLE runs_new RENAME TO runs;
      CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id);
      CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    `);
  }

  // Migrations: add role column to users (default 'admin' so existing users
  // keep full access). RBAC: admin / operator / viewer.
  const userColsRole = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
  if (!userColsRole.some(c => c.name === "role")) {
    db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'`);
  }

  // Migrations: add max_concurrent_runs column to agents (default 1, range 1..10)
  const agentColsConcurrency = db.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[];
  if (!agentColsConcurrency.some(c => c.name === "max_concurrent_runs")) {
    db.exec(`ALTER TABLE agents ADD COLUMN max_concurrent_runs INTEGER NOT NULL DEFAULT 1`);
  }
  if (!agentColsConcurrency.some(c => c.name === "shell_command")) {
    db.exec(`ALTER TABLE agents ADD COLUMN shell_command TEXT`);
  }
  if (!agentColsConcurrency.some(c => c.name === "shell_cwd")) {
    db.exec(`ALTER TABLE agents ADD COLUMN shell_cwd TEXT`);
  }

  // Migrations: add permission_mode column to agents. Existing rows are
  // backfilled to 'unrestricted' to preserve today's behavior (Claude:
  // --dangerously-skip-permissions, Codex: --dangerously-bypass-...,
  // Gemini: --yolo). New Claude agents created from the dashboard default
  // to 'safe' — that logic lives in createAgent, not the column default.
  if (!agentColsConcurrency.some(c => c.name === "permission_mode")) {
    db.exec(`ALTER TABLE agents ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'unrestricted'`);
  }

  // Migrations: tool permissions + API-agent fields. Existing agents
  // backfill to all-permissions-on so behavior is unchanged. The api_*
  // columns stay null for non-api agents.
  const agentColsTools = db.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[];
  if (!agentColsTools.some(c => c.name === "api_base_url")) {
    db.exec(`ALTER TABLE agents ADD COLUMN api_base_url TEXT`);
  }
  if (!agentColsTools.some(c => c.name === "api_key_env")) {
    db.exec(`ALTER TABLE agents ADD COLUMN api_key_env TEXT`);
  }
  for (const col of [
    "can_read_docs", "can_write_docs",
    "can_read_databases", "can_write_databases",
    "can_read_env_vars",
    "can_create_runs", "can_create_handoffs",
    "can_post_activity", "can_update_status",
    "can_use_shell",
  ]) {
    if (!agentColsTools.some(c => c.name === col)) {
      db.exec(`ALTER TABLE agents ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 1`);
    }
  }

  // Migrations: teams + team_agents tables (created above for fresh installs;
  // CREATE TABLE IF NOT EXISTS in the canonical block covers existing dbs too)

  // Migrations: add team_id, preferred_role, role_fallback columns to jobs
  const jobColsTeam = db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[];
  if (!jobColsTeam.some(c => c.name === "team_id")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE SET NULL`);
  }
  if (!jobColsTeam.some(c => c.name === "preferred_role")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN preferred_role TEXT`);
  }
  if (!jobColsTeam.some(c => c.name === "role_fallback")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN role_fallback TEXT NOT NULL DEFAULT 'any'`);
  }

  // Ensure encryption key exists (generates on first run)
  try { encrypt("init"); } catch { /* non-fatal */ }

  // Initialize default settings on first run
  const hasTz = db.prepare(`SELECT 1 FROM settings WHERE key = 'timezone'`).get();
  if (!hasTz) {
    const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).run("timezone", systemTz);
  }
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).run("signup_enabled", "true");

  seedDefaultAutonomyPolicySqlite(db);
}

/**
 * Seed a single global "Default Safety Policy" if none exists. Idempotent —
 * runs on every `initializeSchema` but skips when any global policy is present,
 * so users who delete or customize the seed don't have it re-created.
 */
function seedDefaultAutonomyPolicySqlite(db: Database.Database) {
  const has = db.prepare(`SELECT 1 FROM autonomy_policies WHERE scope_type = 'global' LIMIT 1`).get();
  if (has) return;

  const policyId = "ap_default_global";
  db.prepare(
    `INSERT INTO autonomy_policies (id, name, description, scope_type, scope_id, enabled) VALUES (?, ?, ?, 'global', NULL, 1)`,
  ).run(policyId, "Default Safety Policy", "Built-in baseline. High-risk actions require approval; medium spend is auto-allowed up to $10.");

  // (action_type, risk_level, require_approval, max_cost_usd)
  const seed: [string, "low" | "medium" | "high" | "critical", number, number | null][] = [
    ["send_email",         "high",     1, null],
    ["send_message",       "high",     1, null],
    ["contact_customer",   "high",     1, null],
    ["spend_money",        "medium",   0, 10],
    ["deploy_code",        "high",     1, null],
    ["merge_pr",           "high",     1, null],
    ["delete_data",        "critical", 1, null],
    ["modify_production",  "high",     1, null],
    ["use_secret",         "high",     1, null],
    ["external_api_call",  "high",     1, null],
    ["create_handoff",     "high",     1, null],
    ["update_status",      "low",      0, null],
    ["custom",             "high",     1, null],
  ];

  const ruleStmt = db.prepare(
    `INSERT INTO policy_rules (id, policy_id, action_type, risk_level, require_approval, max_cost_usd) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const [action, risk, requireApproval, maxCost] of seed) {
    ruleStmt.run(`pr_default_${action}`, policyId, action, risk, requireApproval, maxCost);
  }
}

export type { DbAdapter };
export { SqliteAdapter, PostgresAdapter, wrapSqliteDb };
