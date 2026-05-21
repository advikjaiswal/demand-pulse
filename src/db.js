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
      topic_score INTEGER DEFAULT 0,
      pain_score INTEGER DEFAULT 0,
      buyer_intent_score INTEGER DEFAULT 0,
      content_value_score INTEGER DEFAULT 0,
      engagement_score INTEGER DEFAULT 0,
      freshness_score INTEGER DEFAULT 0,
      spam_noise_score INTEGER DEFAULT 0,
      post_type TEXT,
      is_best BOOLEAN DEFAULT false,
      intent TEXT,
      audience_segment TEXT,
      funnel_stage TEXT,
      service_match TEXT,
      content_angle TEXT,
      recommended_format TEXT,
      cta TEXT,
      confidence INTEGER DEFAULT 0,
      UNIQUE(workspace_id, platform, platform_id)
    )
  `;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS topic_score INTEGER DEFAULT 0`;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS pain_score INTEGER DEFAULT 0`;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS buyer_intent_score INTEGER DEFAULT 0`;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS content_value_score INTEGER DEFAULT 0`;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS engagement_score INTEGER DEFAULT 0`;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS freshness_score INTEGER DEFAULT 0`;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS spam_noise_score INTEGER DEFAULT 0`;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS post_type TEXT`;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS is_best BOOLEAN DEFAULT false`;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS intent TEXT`;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS audience_segment TEXT`;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS funnel_stage TEXT`;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS service_match TEXT`;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS content_angle TEXT`;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS recommended_format TEXT`;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS cta TEXT`;
  await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS confidence INTEGER DEFAULT 0`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prospects_workspace ON prospects(workspace_id, scraped_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prospects_topic ON prospects(workspace_id, topic)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prospects_best ON prospects(workspace_id, is_best, relevance DESC)`;

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
      target_type TEXT,
      target_id INTEGER,
      label TEXT,
      message TEXT NOT NULL,
      page TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await sql`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS target_type TEXT`;
  await sql`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS target_id INTEGER`;
  await sql`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS label TEXT`;
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
    INSERT INTO prospects (
      workspace_id, platform, platform_id, username, profile_url, post_url, post_title, post_body,
      score, num_comments, relevance, quality, keyword, topic, is_question, pain_point, created_at,
      topic_score, pain_score, buyer_intent_score, content_value_score, engagement_score,
      freshness_score, spam_noise_score, post_type, is_best, intent, audience_segment,
      funnel_stage, service_match, content_angle, recommended_format, cta, confidence
    )
    VALUES (
      ${workspace_id}, ${p.platform}, ${p.platform_id}, ${p.username || null}, ${p.profile_url || null}, ${p.post_url}, ${p.post_title || null}, ${p.post_body || null},
      ${p.score || 0}, ${p.num_comments || 0}, ${p.relevance || 0}, ${p.quality || 'cold'}, ${p.keyword || null}, ${p.topic || null}, ${p.is_question || false}, ${p.pain_point || null}, ${p.created_at || null},
      ${p.topic_score || 0}, ${p.pain_score || 0}, ${p.buyer_intent_score || 0}, ${p.content_value_score || 0}, ${p.engagement_score || 0},
      ${p.freshness_score || 0}, ${p.spam_noise_score || 0}, ${p.post_type || null}, ${p.is_best || false}, ${p.intent || null}, ${p.audience_segment || null},
      ${p.funnel_stage || null}, ${p.service_match || null}, ${p.content_angle || null}, ${p.recommended_format || null}, ${p.cta || null}, ${p.confidence || 0}
    )
    ON CONFLICT (workspace_id, platform, platform_id) DO UPDATE SET
      relevance = GREATEST(prospects.relevance, EXCLUDED.relevance),
      quality = CASE WHEN EXCLUDED.relevance > prospects.relevance THEN EXCLUDED.quality ELSE prospects.quality END,
      topic = COALESCE(EXCLUDED.topic, prospects.topic),
      is_question = prospects.is_question OR EXCLUDED.is_question,
      pain_point = COALESCE(EXCLUDED.pain_point, prospects.pain_point),
      topic_score = GREATEST(prospects.topic_score, EXCLUDED.topic_score),
      pain_score = GREATEST(prospects.pain_score, EXCLUDED.pain_score),
      buyer_intent_score = GREATEST(prospects.buyer_intent_score, EXCLUDED.buyer_intent_score),
      content_value_score = GREATEST(prospects.content_value_score, EXCLUDED.content_value_score),
      engagement_score = GREATEST(prospects.engagement_score, EXCLUDED.engagement_score),
      freshness_score = GREATEST(prospects.freshness_score, EXCLUDED.freshness_score),
      spam_noise_score = COALESCE(LEAST(NULLIF(prospects.spam_noise_score, 0), EXCLUDED.spam_noise_score), EXCLUDED.spam_noise_score, prospects.spam_noise_score),
      post_type = COALESCE(EXCLUDED.post_type, prospects.post_type),
      is_best = prospects.is_best OR EXCLUDED.is_best,
      intent = COALESCE(EXCLUDED.intent, prospects.intent),
      audience_segment = COALESCE(EXCLUDED.audience_segment, prospects.audience_segment),
      funnel_stage = COALESCE(EXCLUDED.funnel_stage, prospects.funnel_stage),
      service_match = COALESCE(EXCLUDED.service_match, prospects.service_match),
      content_angle = COALESCE(EXCLUDED.content_angle, prospects.content_angle),
      recommended_format = COALESCE(EXCLUDED.recommended_format, prospects.recommended_format),
      cta = COALESCE(EXCLUDED.cta, prospects.cta),
      confidence = GREATEST(prospects.confidence, EXCLUDED.confidence)
    RETURNING id
  `;
  return rows[0];
}

async function getTopics(workspace_id, { days = 14, minRelevance = 15, bestOnly = true } = {}) {
  const bestFilter = bestOnly ? sql`AND is_best = true` : sql``;
  return await sql`
    SELECT COALESCE(topic, 'general') AS topic, COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE is_question)::int AS question_count,
      ROUND(AVG(relevance))::int AS avg_relevance, MAX(relevance)::int AS max_relevance,
      ROUND(AVG(pain_score))::int AS emotional_intensity,
      ROUND(AVG(buyer_intent_score))::int AS buyer_intent_level,
      SUM(COALESCE(num_comments, 0) + COALESCE(score, 0))::int AS total_engagement,
      (array_agg(COALESCE(pain_point, post_title) ORDER BY relevance DESC))[1] AS best_repeated_question,
      (array_agg(COALESCE(content_angle, post_title) ORDER BY content_value_score DESC))[1] AS best_content_angle,
      array_agg(DISTINCT platform) AS platforms, MAX(scraped_at) AS last_seen
    FROM prospects
    WHERE workspace_id=${workspace_id} ${bestFilter} AND scraped_at > NOW() - (${days}::int || ' days')::interval AND relevance >= ${minRelevance}
    GROUP BY topic
    ORDER BY count DESC, avg_relevance DESC
  `;
}

async function getProspects(workspace_id, { topic = null, quality = null, days = 14, limit = 100, bestOnly = true } = {}) {
  const bestFilter = bestOnly ? sql`AND is_best = true` : sql``;
  if (topic) {
    return await sql`SELECT * FROM prospects WHERE workspace_id=${workspace_id} AND topic=${topic} ${bestFilter} AND scraped_at > NOW() - (${days}::int || ' days')::interval ORDER BY relevance DESC, scraped_at DESC LIMIT ${limit}`;
  }
  if (quality) {
    return await sql`SELECT * FROM prospects WHERE workspace_id=${workspace_id} AND quality=${quality} ${bestFilter} AND scraped_at > NOW() - (${days}::int || ' days')::interval ORDER BY relevance DESC, scraped_at DESC LIMIT ${limit}`;
  }
  return await sql`SELECT * FROM prospects WHERE workspace_id=${workspace_id} ${bestFilter} AND scraped_at > NOW() - (${days}::int || ' days')::interval ORDER BY relevance DESC, scraped_at DESC LIMIT ${limit}`;
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
  const rows = await sql`
    INSERT INTO feedback (user_id, workspace_id, rating, target_type, target_id, label, message, page)
    VALUES (${input.user_id}, ${input.workspace_id || null}, ${input.rating || null}, ${input.target_type || null}, ${input.target_id || null}, ${input.label || null}, ${input.message}, ${input.page || null})
    RETURNING *
  `;
  return rows[0];
}

async function getFeedbackAdjustments(workspace_id) {
  return await sql`
    SELECT label, target_type, target_id, COUNT(*)::int AS count
    FROM feedback
    WHERE workspace_id = ${workspace_id}
    GROUP BY label, target_type, target_id
  `;
}

module.exports = {
  sql, initDb, saveBetaSignup,
  createUser, getUserByEmail, createSession, getSession, touchSession, revokeSession,
  createWorkspace, updateWorkspace, getWorkspaces, getWorkspace,
  createScanRun, finishScanRun, getScanRuns, saveProspect, getTopics, getProspects,
  saveContentItem, getContentItems, updateContentItem, deleteContentItem, saveFeedback, getFeedbackAdjustments
};
