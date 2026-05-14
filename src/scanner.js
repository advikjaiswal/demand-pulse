const { buildQueries } = require('./keywords');
const { enrichPost } = require('./score');
const { searchReddit, searchWebPlatform, sleep } = require('./sources');
const db = require('./db');

const QUERY_LIMIT = parseInt(process.env.DEMAND_QUERIES_PER_SCAN || '8', 10);
const MIN_RELEVANCE = parseInt(process.env.DEMAND_MIN_RELEVANCE || '24', 10);

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
    const sources = ['reddit', 'x', 'quora', 'facebook'];
    for (const source of sources) {
      out.source_counts[source] = 0;
      for (const query of queries) {
        try {
          const posts = await collect(source, query);
          out.found += posts.length;
          for (const post of posts) {
            const enriched = enrichPost(post, workspace, query);
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
    return db.finishScanRun(run.id, { status: 'completed', ...out });
  } catch (err) {
    out.errors.push({ source: 'scan', message: err.message });
    await db.finishScanRun(run.id, { status: 'failed', ...out });
    throw err;
  }
}

module.exports = { runScan };
