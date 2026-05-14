require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const auth = require('./auth');
const db = require('./db');
const { parseWorkspace } = require('./keywords');
const { runScan } = require('./scanner');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress || req.ip || '';
}

function betaOpen() {
  return process.env.DEMAND_BETA_OPEN !== 'false';
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role || 'user' };
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.headers['x-demand-session'];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const token_hash = auth.hashToken(token);
  const session = await db.getSession(token_hash).catch(() => null);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  await db.touchSession(token_hash).catch(() => {});
  req.tokenHash = token_hash;
  req.user = { id: session.user_id, name: session.name, email: session.email, role: session.role || 'user' };
  next();
}

async function loadWorkspace(req, res, next) {
  const id = parseInt(req.params.workspaceId || req.body?.workspace_id || req.query.workspace_id, 10);
  if (!id) return res.status(400).json({ error: 'workspace_id required' });
  const workspace = await db.getWorkspace(id, req.user.id);
  if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
  req.workspace = workspace;
  next();
}

function topicLabel(topic) {
  return String(topic || 'general').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function priority(cluster) {
  const count = Math.min(cluster.count || 0, 30) / 30;
  const rel = Math.min(cluster.avg_relevance || 0, 100) / 100;
  const last = cluster.last_seen ? new Date(cluster.last_seen) : null;
  const ageHrs = last ? (Date.now() - last.getTime()) / 36e5 : 999;
  const recency = ageHrs < 24 ? 1 : ageHrs < 72 ? 0.7 : ageHrs < 168 ? 0.45 : 0.2;
  return Math.round((count * 0.45 + rel * 0.35 + recency * 0.2) * 100);
}

function ideas(topic, prospects = []) {
  const label = topicLabel(topic);
  const questions = prospects.filter(p => p.is_question).slice(0, 6);
  const first = questions[0] || prospects[0];
  const pain = first?.pain_point || first?.post_title || `${label} questions your buyers are asking`;
  return [
    {
      topic,
      topicLabel: label,
      format: 'blog',
      title: `${label}: ${questions.length || prospects.length} Real Questions To Answer This Week`,
      hook: `Use the exact language your audience is already using: "${String(pain).slice(0, 120)}"`,
      outline: questions.map(q => `Answer: ${q.pain_point || q.post_title}`).join('\n') || 'Explain the problem\nShow the common mistake\nGive a practical next step\nAdd a soft CTA'
    },
    {
      topic,
      topicLabel: label,
      format: 'reel',
      title: `60-second answer: ${String(pain).slice(0, 80)}`,
      hook: 'Open with the real question, answer one misconception, close with a simple CTA.',
      outline: 'Hook: read the question\nContext: why people ask this\nAnswer: one clear recommendation\nCTA: invite a reply or booking'
    },
    {
      topic,
      topicLabel: label,
      format: 'linkedin_post',
      title: `What buyers misunderstand about ${label.toLowerCase()}`,
      hook: 'Turn repeated confusion into an authority-building post.',
      outline: 'Misconception\nWhat is actually true\nExample from the market\nPractical advice'
    }
  ];
}

app.get('/health', (_req, res) => res.json({ ok: true, app: 'demand-pulse' }));
app.get('/app', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'app.html')));

app.post('/api/beta/signup', async (req, res) => {
  try {
    const email = auth.normalizeEmail(req.body?.email);
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
    const signup = await db.saveBetaSignup({
      name: String(req.body?.name || '').trim() || null,
      email,
      business_type: String(req.body?.business_type || '').trim() || null,
      website: String(req.body?.website || '').trim() || null,
      goal: String(req.body?.goal || '').trim() || null,
      metadata: { source: 'landing' }
    });
    res.json({ ok: true, signup });
  } catch (err) {
    console.error('[signup]', err.message);
    res.status(500).json({ error: 'Could not save signup' });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    if (!betaOpen()) return res.status(403).json({ error: 'Beta account creation is currently invite-only' });
    const name = String(req.body?.name || '').trim();
    const email = auth.normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!name) return res.status(400).json({ error: 'Name required' });
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
    if (await db.getUserByEmail(email)) return res.status(409).json({ error: 'Account already exists. Please sign in.' });
    const user = await db.createUser({ name, email, password_hash: auth.hashPassword(password) });
    const token = auth.createSessionToken();
    await db.createSession({ user_id: user.id, token_hash: auth.hashToken(token), ip: clientIp(req), user_agent: req.headers['user-agent'] || '' });
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message.includes('Password') ? err.message : 'Could not create account' });
  }
});

app.post('/api/login', async (req, res) => {
  const email = auth.normalizeEmail(req.body?.email);
  const user = await db.getUserByEmail(email);
  if (!user || !auth.verifyPassword(req.body?.password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = auth.createSessionToken();
  await db.createSession({ user_id: user.id, token_hash: auth.hashToken(token), ip: clientIp(req), user_agent: req.headers['user-agent'] || '' });
  res.json({ ok: true, token, user: publicUser(user) });
});

app.post('/api/logout', requireAuth, async (req, res) => {
  await db.revokeSession(req.tokenHash);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  res.json({ ok: true, user: req.user, workspaces: await db.getWorkspaces(req.user.id) });
});

app.post('/api/workspaces', requireAuth, async (req, res) => {
  const workspace = parseWorkspace(req.body || {});
  if (!workspace.name || !workspace.niche) return res.status(400).json({ error: 'Business name and niche are required' });
  res.json(await db.createWorkspace(req.user.id, workspace));
});

app.put('/api/workspaces/:workspaceId', requireAuth, loadWorkspace, async (req, res) => {
  const workspace = parseWorkspace(req.body || {});
  if (!workspace.name || !workspace.niche) return res.status(400).json({ error: 'Business name and niche are required' });
  res.json(await db.updateWorkspace(req.workspace.id, req.user.id, workspace));
});

app.get('/api/workspaces/:workspaceId/overview', requireAuth, loadWorkspace, async (req, res) => {
  const days = parseInt(req.query.days, 10) || 14;
  const [topics, prospects, calendar, scans] = await Promise.all([
    db.getTopics(req.workspace.id, { days }),
    db.getProspects(req.workspace.id, { days, limit: 30 }),
    db.getContentItems(req.workspace.id, { limit: 100 }),
    db.getScanRuns(req.workspace.id, 5)
  ]);
  res.json({
    workspace: req.workspace,
    topics: topics.map(t => ({ ...t, label: topicLabel(t.topic), priority: priority(t) })),
    prospects,
    calendar,
    scans
  });
});

app.post('/api/workspaces/:workspaceId/scan', requireAuth, loadWorkspace, async (req, res) => {
  res.json({ ok: true, message: 'Demand scan started' });
  runScan(req.workspace.id).catch(err => console.error('[scan]', err.message));
});

app.get('/api/workspaces/:workspaceId/prospects', requireAuth, loadWorkspace, async (req, res) => {
  res.json(await db.getProspects(req.workspace.id, {
    topic: req.query.topic || null,
    quality: req.query.quality || null,
    days: parseInt(req.query.days, 10) || 14,
    limit: Math.min(parseInt(req.query.limit, 10) || 100, 500)
  }));
});

app.get('/api/workspaces/:workspaceId/ideas', requireAuth, loadWorkspace, async (req, res) => {
  const topic = req.query.topic || 'general';
  const prospects = await db.getProspects(req.workspace.id, { topic, days: parseInt(req.query.days, 10) || 14, limit: 30 });
  res.json(ideas(topic, prospects));
});

app.get('/api/workspaces/:workspaceId/calendar', requireAuth, loadWorkspace, async (req, res) => {
  res.json(await db.getContentItems(req.workspace.id, { status: req.query.status || null }));
});

app.post('/api/workspaces/:workspaceId/calendar', requireAuth, loadWorkspace, async (req, res) => {
  const { topic, format, title, hook, outline, notes, source_prospect_ids, priority, status, scheduled_for } = req.body || {};
  if (!topic || !format || !title) return res.status(400).json({ error: 'topic, format, title required' });
  res.json(await db.saveContentItem(req.workspace.id, { topic, format, title, hook, outline, notes, source_prospect_ids, priority, status, scheduled_for }));
});

app.patch('/api/workspaces/:workspaceId/calendar/:id', requireAuth, loadWorkspace, async (req, res) => {
  const item = await db.updateContentItem(req.workspace.id, req.params.id, req.body || {});
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.delete('/api/workspaces/:workspaceId/calendar/:id', requireAuth, loadWorkspace, async (req, res) => {
  await db.deleteContentItem(req.workspace.id, req.params.id);
  res.json({ ok: true });
});

app.post('/api/feedback', requireAuth, async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Feedback message required' });
  res.json(await db.saveFeedback({
    user_id: req.user.id,
    workspace_id: req.body?.workspace_id ? parseInt(req.body.workspace_id, 10) : null,
    rating: req.body?.rating ? parseInt(req.body.rating, 10) : null,
    message,
    page: req.body?.page || null
  }));
});

const port = process.env.PORT || 3000;
init().catch(err => {
  console.error('[boot]', err);
  process.exit(1);
});

async function init() {
  await db.initDb();
  app.listen(port, () => console.log(`Demand Pulse listening on ${port}`));
}
