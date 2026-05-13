import type { DbAdapter } from "./adapter";
import { encrypt } from "../encryption";

/** Postgres schema initialization. Greenfield install only — there are no
 *  historical migrations since PG support is new in this release. The schema
 *  must stay structurally identical to the SQLite canonical schema in
 *  src/lib/db/schema.ts (initializeSchema). Type mappings:
 *    - INTEGER unix timestamp DEFAULT (unixepoch())  →  BIGINT DEFAULT (extract(epoch from now())::bigint)
 *    - INTEGER PRIMARY KEY AUTOINCREMENT             →  BIGSERIAL PRIMARY KEY
 *    - INTEGER used as boolean 0/1                   →  INTEGER (unchanged — avoids touching app code)
 *  Everything else (TEXT, REAL, CHECK, REFERENCES ... ON DELETE CASCADE) is
 *  identical between the two engines. */
export async function initializePostgresSchema(db: DbAdapter): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin'
        CHECK(role IN ('admin','operator','viewer')),
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      api_key_hash TEXT NOT NULL,
      max_concurrent_runs INTEGER NOT NULL DEFAULT 1 CHECK(max_concurrent_runs BETWEEN 1 AND 10),
      shell_command TEXT,
      shell_cwd TEXT,
      last_polled_at BIGINT,
      type TEXT NOT NULL DEFAULT 'external',
      cli TEXT,
      model TEXT,
      thinking TEXT,
      remote INTEGER NOT NULL DEFAULT 0,
      eager INTEGER NOT NULL DEFAULT 0,
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
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS team_agents (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'custom' CHECK(role IN ('researcher','builder','reviewer','debugger','custom')),
      custom_role TEXT,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      PRIMARY KEY (team_id, agent_id)
    );

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
      last_run_at BIGINT,
      next_run_at BIGINT,
      model TEXT,
      thinking TEXT,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('scheduled','running','waiting','pending','done','failed','skipped','killed')),
      scheduled_for BIGINT,
      claimed_at BIGINT,
      completed_at BIGINT,
      kill_requested_at BIGINT,
      extra_instructions TEXT,
      session_id TEXT,
      session_cwd TEXT,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS run_activity (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      author_type TEXT NOT NULL CHECK(author_type IN ('agent','user','system')),
      author_id TEXT,
      author_name TEXT,
      content TEXT,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_by_type TEXT CHECK(created_by_type IN ('user','agent')),
      created_by_id TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS doc_revisions (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      author_type TEXT CHECK(author_type IN ('user','agent')),
      author_id TEXT,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS job_docs (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      PRIMARY KEY (job_id, doc_id)
    );

    CREATE TABLE IF NOT EXISTS databases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      table_name TEXT NOT NULL UNIQUE,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS database_migrations (
      id TEXT PRIMARY KEY,
      database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      description TEXT,
      sql TEXT NOT NULL,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS job_databases (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
      PRIMARY KEY (job_id, database_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS env_vars (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      encrypted_value TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS job_env_vars (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      env_var_id TEXT NOT NULL REFERENCES env_vars(id) ON DELETE CASCADE,
      PRIMARY KEY (job_id, env_var_id)
    );

    CREATE TABLE IF NOT EXISTS run_attachments (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      activity_id TEXT REFERENCES run_activity(id) ON DELETE SET NULL,
      kind TEXT NOT NULL CHECK(kind IN ('file','embed')),
      filename TEXT,
      storage_path TEXT,
      mime_type TEXT,
      size_bytes BIGINT,
      url TEXT,
      embed_provider TEXT,
      title TEXT,
      uploaded_by_type TEXT CHECK(uploaded_by_type IN ('user','agent')),
      uploaded_by_id TEXT,
      uploaded_by_name TEXT,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS run_output (
      id BIGSERIAL PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      content TEXT,
      tool_name TEXT,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS run_costs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
      provider TEXT,
      model TEXT,
      input_tokens BIGINT,
      output_tokens BIGINT,
      total_tokens BIGINT,
      estimated_cost_usd DOUBLE PRECISION,
      pricing_known INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
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

    CREATE TABLE IF NOT EXISTS attachment_processing (
      id TEXT PRIMARY KEY,
      attachment_id TEXT NOT NULL UNIQUE REFERENCES run_attachments(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','processing','done','failed')),
      transcript_path TEXT,
      screenshots_dir TEXT,
      screenshot_count INTEGER NOT NULL DEFAULT 0,
      screenshot_interval INTEGER,
      duration_seconds DOUBLE PRECISION,
      error TEXT,
      started_at BIGINT,
      completed_at BIGINT,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS captain_conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      cli TEXT NOT NULL,
      model TEXT,
      thinking TEXT,
      session_id TEXT,
      cwd TEXT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS captain_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES captain_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS captain_output (
      id BIGSERIAL PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES captain_conversations(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES captain_messages(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      content TEXT,
      tool_name TEXT,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

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
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS admin_api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key_hash TEXT NOT NULL UNIQUE,
      created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_used_at BIGINT,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      department TEXT,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft','active','paused','archived')),
      autonomy_level TEXT NOT NULL DEFAULT 'supervised'
        CHECK(autonomy_level IN ('manual','supervised','autonomous')),
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
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
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK(status IN ('running','waiting_for_approval','done','failed','rejected')),
      current_step_id TEXT REFERENCES workflow_steps(id) ON DELETE SET NULL,
      started_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      input_payload TEXT,
      started_at BIGINT,
      completed_at BIGINT,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
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
      approval_at BIGINT,
      approval_comment TEXT,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
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
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS autonomy_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      scope_type TEXT NOT NULL
        CHECK(scope_type IN ('global','department','workflow','agent','team')),
      scope_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint)
    );

    CREATE TABLE IF NOT EXISTS policy_rules (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES autonomy_policies(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      risk_level TEXT NOT NULL
        CHECK(risk_level IN ('low','medium','high','critical')),
      require_approval INTEGER NOT NULL DEFAULT 0,
      max_cost_usd DOUBLE PRECISION,
      allowed_roles TEXT,
      approval_roles TEXT,
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
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
      created_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint),
      resolved_at BIGINT
    );

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
  `);

  try { encrypt("init"); } catch { /* non-fatal */ }

  const hasTz = await db.get(`SELECT 1 AS one FROM settings WHERE key = 'timezone'`);
  if (!hasTz) {
    const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING`, ["timezone", systemTz]);
  }
  await db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING`, ["signup_enabled", "true"]);

  await seedDefaultAutonomyPolicyPostgres(db);
}

/** Postgres mirror of seedDefaultAutonomyPolicySqlite in schema.ts. */
async function seedDefaultAutonomyPolicyPostgres(db: DbAdapter): Promise<void> {
  const has = await db.get(`SELECT 1 AS one FROM autonomy_policies WHERE scope_type = 'global' LIMIT 1`);
  if (has) return;

  const policyId = "ap_default_global";
  await db.run(
    `INSERT INTO autonomy_policies (id, name, description, scope_type, scope_id, enabled) VALUES (?, ?, ?, 'global', NULL, 1)`,
    [policyId, "Default Safety Policy", "Built-in baseline. High-risk actions require approval; medium spend is auto-allowed up to $10."],
  );

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
  for (const [action, risk, requireApproval, maxCost] of seed) {
    await db.run(
      `INSERT INTO policy_rules (id, policy_id, action_type, risk_level, require_approval, max_cost_usd) VALUES (?, ?, ?, ?, ?, ?)`,
      [`pr_default_${action}`, policyId, action, risk, requireApproval, maxCost],
    );
  }
}
