function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  return String(value || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean);
}

function uniq(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = String(value || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(value).trim());
  }
  return out;
}

function parseWorkspace(body = {}) {
  return {
    name: String(body.name || '').trim(),
    website: String(body.website || '').trim() || null,
    business_type: String(body.business_type || '').trim() || null,
    niche: String(body.niche || '').trim(),
    geography: String(body.geography || '').trim() || null,
    services: splitList(body.services),
    competitors: splitList(body.competitors),
    blocked_terms: splitList(body.blocked_terms)
  };
}

function buildQueries(workspace, { limit = 8 } = {}) {
  const geography = String(workspace.geography || '').trim();
  const services = splitList(workspace.services);
  const base = uniq([workspace.niche, workspace.business_type, ...services].filter(Boolean));
  const primary = services.length ? services : base;
  const prefixes = ['recommend', 'looking for', 'need help with', 'best', 'how to choose', 'questions about'];
  const queries = [];

  for (const term of primary) {
    for (const prefix of prefixes) {
      queries.push(`${prefix} ${term}${geography ? ` ${geography}` : ''}`);
      queries.push(`${term} ${prefix}`);
    }
  }
  for (const term of base) {
    queries.push(`${term} advice`);
    queries.push(`${term} experience`);
  }
  return uniq(queries).slice(0, limit);
}

module.exports = { splitList, parseWorkspace, buildQueries };
