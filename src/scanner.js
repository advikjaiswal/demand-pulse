const { buildQueries } = require('./keywords');
const { enrichPost } = require('./score');
const { searchReddit, searchWebPlatform, sleep } = require('./sources');
const db = require('./db');

const QUERY_LIMIT = parseInt(process.env.DEMAND_QUERIES_PER_SCAN || '8', 10);
const MIN_RELEVANCE = parseInt(process.env.DEMAND_MIN_RELEVANCE || '18', 10);

async function collect(source, query) {
  if (source === 'reddit') return searchReddit(query);
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
    const sources = ['reddit', 'x', 'quora', 'facebook'];
    for (const source of sources) {
      out.source_counts[source] = 0;
      for (const query of queries) {
        try {
          const posts = await collect(source, query);
          out.found += posts.length;
          for (const post of posts) {
            const enriched = applyFeedback(enrichPost(post, workspace, query), feedback);
            if (enriched.relevance < minRelevance) {
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
    if (out.saved === 0) {
      out.source_counts.starter = 0;
      for (const post of starterPosts(workspace)) {
        const enriched = {
          ...enrichPost(post, workspace, 'starter demand map'),
          relevance: 58,
          quality: 'warm',
          pain_score: 55,
          buyer_intent_score: 52,
          content_value_score: 70,
          spam_noise_score: 0,
          post_type: 'starter_opportunity',
          is_best: true,
          intent: 'Starter research direction',
          funnel_stage: 'Awareness',
          content_angle: post.post_title,
          recommended_format: 'Blog + Reel + Search Answer',
          cta: `Offer a simple next step for ${workspace.services?.[0] || workspace.niche || 'this problem'}`,
          confidence: 58
        };
        await db.saveProspect(workspace.id, enriched);
        out.saved++;
        out.source_counts.starter++;
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

function starterPosts(workspace) {
  const niche = workspace.niche || workspace.business_type || 'this market';
  const services = workspace.services?.length ? workspace.services.slice(0, 3) : [niche];
  const geography = workspace.geography ? ` ${workspace.geography}` : '';
  return services.map((service, index) => {
    const query = encodeURIComponent(`problems with ${service}${geography}`);
    return {
      platform: 'starter',
      platform_id: `starter-${workspace.id}-${index}-${String(service).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      username: null,
      profile_url: null,
      post_url: `https://www.google.com/search?q=${query}`,
      post_title: `What problems are people having with ${service}?`,
      post_body: `No strong public posts were saved yet, so Demand Pulse created this starter research direction from your workspace. Use the source link to inspect live search demand, then run another scan with more specific services or a geography.`,
      score: 0,
      num_comments: 0,
      created_at: new Date().toISOString()
    };
  });
}

module.exports = { runScan };
