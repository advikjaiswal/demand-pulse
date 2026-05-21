const { buildQueries } = require('./keywords');
const { enrichPost } = require('./score');
const { searchReddit, searchWebPlatform, searchWeb, sleep } = require('./sources');
const db = require('./db');

const QUERY_LIMIT = parseInt(process.env.DEMAND_QUERIES_PER_SCAN || '6', 10);
const MIN_RELEVANCE = parseInt(process.env.DEMAND_MIN_RELEVANCE || '0', 10);

async function collect(source, query) {
  if (source === 'reddit') return searchReddit(query);
  if (source === 'web') return searchWeb(query);
  return searchWebPlatform(source, query);
}

async function runScan(workspaceId, { queryLimit = QUERY_LIMIT, minRelevance = MIN_RELEVANCE } = {}) {
  const workspace = await db.getWorkspace(workspaceId);
  if (!workspace) throw new Error('Workspace not found');
  const run = await db.createScanRun(workspace.id);
  const out = { found: 0, saved: 0, skipped: 0, source_counts: {}, errors: [] };

  try {
    const queries = buildQueries(workspace, { limit: queryLimit });
    const feedback = await db.getFeedbackAdjustments(workspace.id).catch(() => []);
    const sources = ['reddit', 'quora', 'web', 'x', 'facebook'];
    for (const source of sources) {
      out.source_counts[source] = 0;
      for (const query of queries) {
        try {
          const posts = await collect(source, query);
          out.found += posts.length;
          for (const post of posts) {
            const enriched = applyFeedback(enrichPost(post, workspace, query), feedback);
            if (enriched.spam_noise_score >= 65 || enriched.relevance < minRelevance) {
              out.skipped++;
              continue;
            }
            await db.saveProspect(workspace.id, enriched);
            out.saved++;
            out.source_counts[source]++;
          }
          await sleep(source === 'reddit' ? 1200 : 1500);
        } catch (err) {
          out.errors.push({ source, query, message: err.message });
        }
      }
    }
    return db.finishScanRun(run.id, { status: 'completed', ...out });
  } catch (err) {
    out.errors.push({ source: 'scan', message: err.message });
    await db.finishScanRun(run.id, { status: 'failed', ...out });
    throw err;
  }
}

function applyFeedback(post, feedback) {
  const topicLabels = feedback.filter(f => f.target_type === 'topic' && f.target_id === null);
  const useful = ['useful', 'good_for_content', 'good_lead'];
  const bad = ['not_useful', 'too_broad', 'wrong_topic', 'spam', 'duplicate'];
  let adjustment = 0;
  for (const item of topicLabels) {
    if (useful.includes(item.label)) adjustment += Math.min(item.count * 2, 10);
    if (bad.includes(item.label)) adjustment -= Math.min(item.count * 3, 18);
  }
  if (!adjustment) return post;
  const relevance = Math.max(0, Math.min(100, post.relevance + adjustment));
  return {
    ...post,
    relevance,
    quality: relevance >= 65 ? 'hot' : relevance >= 35 ? 'warm' : 'cold',
    is_best: post.is_best && relevance >= 30
  };
}

module.exports = { runScan };
