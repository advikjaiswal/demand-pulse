require('dotenv').config();
const postgres = require('postgres');

if (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') {
  throw new Error('DATABASE_URL is required');
}

const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL, { ssl: process.env.DATABASE_URL.includes('localhost') ? false : 'require' }) : null;

async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS beta_signups (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT NOT NULL,
      business_type TEXT,
      website TEXT,
      goal TEXT,
      status TEXT DEFAULT 'new',
      metadata JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_beta_signups_email ON beta_signups(LOWER(email))`;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      ip TEXT,
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      revoked BOOLEAN DEFAULT false
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS workspaces (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      website TEXT,
      business_type TEXT,
      niche TEXT NOT NULL,
      geography TEXT,
      services TEXT[] DEFAULT '{}',
      competitors TEXT[] DEFAULT '{}',
      blocked_terms TEXT[] DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS scan_runs (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'running',
      found INTEGER DEFAULT 0,
      saved INTEGER DEFAULT 0,
      skipped INTEGER DEFAULT 0,
      source_counts JSONB,
      errors JSONB,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS prospects (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      platform_id TEXT NOT NULL,
      username TEXT,
      profile_url TEXT,
      post_url TEXT NOT NULL,
      post_title TEXT,
      post_body TEXT,
      score INTEGER DEFAULT 0,
      num_comments INTEGER DEFAULT 0,
      relevance INTEGER DEFAULT 0,
      quality TEXT DEFAULT 'cold',
      keyword TEXT,
      topic TEXT,
      is_question BOOLEAN DEFAULT false,
      pain_point TEXT,
      created_at TIMESTAMP,
      scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'new',
      UNIQUE(workspace_id, platform, platform_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_prospects_workspace ON prospects(workspace_id, scraped_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prospects_topic ON prospects(workspace_id, topic)`;

  await sql`
    CREATE TABLE IF NOT EXISTS content_items (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      format TEXT NOT NULL,
      title TEXT NOT NULL,
      hook TEXT,
      outline TEXT,
      notes TEXT,
      source_prospect_ids INTEGER[],
      priority INTEGER DEFAULT 0,
      status TEXT DEFAULT 'planned',
      scheduled_for DATE,
      published_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS feedback (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
      rating INTEGER,
      message TEXT NOT NULL,
      page TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
}

async function saveBetaSignup(input) {
  const rows = await sql`
    INSERT INTO beta_signups (name, email, business_type, website, goal, metadata)
    VALUES (${input.name || null}, ${input.email}, ${input.business_type || null}, ${input.website || null}, ${input.goal || null}, ${sql.json(input.metadata || {})})
    RETURNING id, name, email, business_type, website, goal, status, created_at
  `;
  return rows[0];
}

async function createUser({ name, email, password_hash }) {
  const rows = await sql`INSERT INTO users (name, email, password_hash) VALUES (${name}, ${email}, ${password_hash}) RETURNING id, name, email, role, created_at`;
  return rows[0];
}

async function getUserByEmail(email) {
  const rows = await sql`SELECT * FROM users WHERE email = ${email} LIMIT 1`;
  return rows[0] || null;
}

async function createSession({ user_id, token_hash, ip = null, user_agent = null }) {
  const rows = await sql`INSERT INTO sessions (user_id, token_hash, ip, user_agent) VALUES (${user_id}, ${token_hash}, ${ip}, ${user_agent}) RETURNING *`;
  return rows[0];
}

async function getSession(token_hash) {
  const rows = await sql`
    SELECT s.*, u.name, u.email, u.role FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${token_hash} AND s.revoked = false
    LIMIT 1
  `;
  return rows[0] || null;
}

async function touchSession(token_hash) {
  await sql`UPDATE sessions SET last_seen = NOW() WHERE token_hash = ${token_hash} AND revoked = false`;
}

async function revokeSession(token_hash) {
  await sql`UPDATE sessions SET revoked = true WHERE token_hash = ${token_hash}`;
}

async function createWorkspace(user_id, workspace) {
  const rows = await sql`
    INSERT INTO workspaces (user_id, name, website, business_type, niche, geography, services, competitors, blocked_terms)
    VALUES (${user_id}, ${workspace.name}, ${workspace.website}, ${workspace.business_type}, ${workspace.niche}, ${workspace.geography}, ${workspace.services}, ${workspace.competitors}, ${workspace.blocked_terms})
    RETURNING *
  `;
  return rows[0];
}

async function updateWorkspace(id, user_id, workspace) {
  const rows = await sql`
    UPDATE workspaces SET
      name=${workspace.name}, website=${workspace.website}, business_type=${workspace.business_type},
      niche=${workspace.niche}, geography=${workspace.geography}, services=${workspace.services},
      competitors=${workspace.competitors}, blocked_terms=${workspace.blocked_terms}, updated_at=NOW()
    WHERE id=${id} AND user_id=${user_id}
    RETURNING *
  `;
  return rows[0] || null;
}

async function getWorkspaces(user_id) {
  return await sql`SELECT * FROM workspaces WHERE user_id = ${user_id} ORDER BY created_at ASC`;
}

async function getWorkspace(id, user_id = null) {
  const rows = user_id
    ? await sql`SELECT * FROM workspaces WHERE id = ${id} AND user_id = ${user_id} LIMIT 1`
    : await sql`SELECT * FROM workspaces WHERE id = ${id} LIMIT 1`;
  return rows[0] || null;
}

async function createScanRun(workspace_id) {
  const rows = await sql`INSERT INTO scan_runs (workspace_id, source_counts, errors) VALUES (${workspace_id}, ${sql.json({})}, ${sql.json([])}) RETURNING *`;
  return rows[0];
}

async function finishScanRun(id, fields) {
  const rows = await sql`
    UPDATE scan_runs SET status=${fields.status}, found=${fields.found || 0}, saved=${fields.saved || 0},
      skipped=${fields.skipped || 0}, source_counts=${sql.json(fields.source_counts || {})},
      errors=${sql.json(fields.errors || [])}, completed_at=NOW()
    WHERE id=${id}
    RETURNING *
  `;
  return rows[0];
}

async function getScanRuns(workspace_id, limit = 10) {
  return await sql`SELECT * FROM scan_runs WHERE workspace_id=${workspace_id} ORDER BY started_at DESC LIMIT ${limit}`;
}

async function saveProspect(workspace_id, p) {
  const rows = await sql`
    INSERT INTO prospects (workspace_id, platform, platform_id, username, profile_url, post_url, post_title, post_body, score, num_comments, relevance, quality, keyword, topic, is_question, pain_point, created_at)
    VALUES (${workspace_id}, ${p.platform}, ${p.platform_id}, ${p.username || null}, ${p.profile_url || null}, ${p.post_url}, ${p.post_title || null}, ${p.post_body || null}, ${p.score || 0}, ${p.num_comments || 0}, ${p.relevance || 0}, ${p.quality || 'cold'}, ${p.keyword || null}, ${p.topic || null}, ${p.is_question || false}, ${p.pain_point || null}, ${p.created_at || null})
    ON CONFLICT (workspace_id, platform, platform_id) DO UPDATE SET
      relevance = GREATEST(prospects.relevance, EXCLUDED.relevance),
      quality = CASE WHEN EXCLUDED.relevance > prospects.relevance THEN EXCLUDED.quality ELSE prospects.quality END,
      topic = COALESCE(EXCLUDED.topic, prospects.topic),
      is_question = prospects.is_question OR EXCLUDED.is_question,
      pain_point = COALESCE(EXCLUDED.pain_point, prospects.pain_point)
    RETURNING id
  `;
  return rows[0];
}

async function getTopics(workspace_id, { days = 14, minRelevance = 15 } = {}) {
  return await sql`
    SELECT COALESCE(topic, 'general') AS topic, COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE is_question)::int AS question_count,
      ROUND(AVG(relevance))::int AS avg_relevance, MAX(relevance)::int AS max_relevance,
      array_agg(DISTINCT platform) AS platforms, MAX(scraped_at) AS last_seen
    FROM prospects
    WHERE workspace_id=${workspace_id} AND scraped_at > NOW() - (${days}::int || ' days')::interval AND relevance >= ${minRelevance}
    GROUP BY topic
    ORDER BY count DESC, avg_relevance DESC
  `;
}

async function getProspects(workspace_id, { topic = null, quality = null, days = 14, limit = 100 } = {}) {
  if (topic) {
    return await sql`SELECT * FROM prospects WHERE workspace_id=${workspace_id} AND topic=${topic} AND scraped_at > NOW() - (${days}::int || ' days')::interval ORDER BY relevance DESC, scraped_at DESC LIMIT ${limit}`;
  }
  if (quality) {
    return await sql`SELECT * FROM prospects WHERE workspace_id=${workspace_id} AND quality=${quality} AND scraped_at > NOW() - (${days}::int || ' days')::interval ORDER BY relevance DESC, scraped_at DESC LIMIT ${limit}`;
  }
  return await sql`SELECT * FROM prospects WHERE workspace_id=${workspace_id} AND scraped_at > NOW() - (${days}::int || ' days')::interval ORDER BY relevance DESC, scraped_at DESC LIMIT ${limit}`;
}

async function saveContentItem(workspace_id, item) {
  const rows = await sql`
    INSERT INTO content_items (workspace_id, topic, format, title, hook, outline, notes, source_prospect_ids, priority, status, scheduled_for)
    VALUES (${workspace_id}, ${item.topic}, ${item.format}, ${item.title}, ${item.hook || null}, ${item.outline || null}, ${item.notes || null}, ${item.source_prospect_ids || null}, ${item.priority || 0}, ${item.status || 'planned'}, ${item.scheduled_for || null})
    RETURNING *
  `;
  return rows[0];
}

async function getContentItems(workspace_id, { status = null, limit = 200 } = {}) {
  if (status) return await sql`SELECT * FROM content_items WHERE workspace_id=${workspace_id} AND status=${status} ORDER BY COALESCE(scheduled_for, created_at::date), priority DESC LIMIT ${limit}`;
  return await sql`SELECT * FROM content_items WHERE workspace_id=${workspace_id} ORDER BY COALESCE(scheduled_for, created_at::date), priority DESC LIMIT ${limit}`;
}

async function updateContentItem(workspace_id, id, fields) {
  const allowed = ['topic', 'format', 'title', 'hook', 'outline', 'notes', 'priority', 'status', 'scheduled_for', 'published_url'];
  const updates = {};
  for (const key of allowed) if (fields[key] !== undefined) updates[key] = fields[key];
  const rows = await sql`UPDATE content_items SET ${sql(updates)}, updated_at=NOW() WHERE workspace_id=${workspace_id} AND id=${id} RETURNING *`;
  return rows[0] || null;
}

async function deleteContentItem(workspace_id, id) {
  await sql`DELETE FROM content_items WHERE workspace_id=${workspace_id} AND id=${id}`;
}

async function saveFeedback(input) {
  const rows = await sql`INSERT INTO feedback (user_id, workspace_id, rating, message, page) VALUES (${input.user_id}, ${input.workspace_id || null}, ${input.rating || null}, ${input.message}, ${input.page || null}) RETURNING *`;
  return rows[0];
}

module.exports = {
  sql, initDb, saveBetaSignup,
  createUser, getUserByEmail, createSession, getSession, touchSession, revokeSession,
  createWorkspace, updateWorkspace, getWorkspaces, getWorkspace,
  createScanRun, finishScanRun, getScanRuns, saveProspect, getTopics, getProspects,
  saveContentItem, getContentItems, updateContentItem, deleteContentItem, saveFeedback
};
