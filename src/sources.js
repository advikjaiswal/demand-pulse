const axios = require('axios');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function searchReddit(query, { limit = 10 } = {}) {
  const url = 'https://www.reddit.com/search.json';
  const response = await axios.get(url, {
    params: { q: query, sort: 'new', t: 'month', limit },
    headers: { 'User-Agent': 'DemandPulseBeta/0.1' },
    timeout: 15000
  });
  const posts = response.data?.data?.children || [];
  return posts.map(p => parseRedditPost(p.data)).filter(Boolean);
}

function parseRedditPost(data) {
  if (!data || !data.author || data.author === '[deleted]' || data.author === 'AutoModerator') return null;
  const title = (data.title || '').trim();
  const body = (data.selftext || '').trim();
  if (!title && !body) return null;
  return {
    platform: 'reddit',
    platform_id: data.id,
    username: data.author,
    profile_url: `https://www.reddit.com/user/${data.author}`,
    post_url: `https://www.reddit.com${data.permalink}`,
    post_title: title,
    post_body: body.slice(0, 2000),
    score: data.score || 0,
    num_comments: data.num_comments || 0,
    created_at: new Date(data.created_utc * 1000).toISOString()
  };
}

async function webSearch(query, { siteFilter, count = 10 } = {}) {
  const fullQuery = siteFilter ? `site:${siteFilter} ${query}` : query;
  if (process.env.BRAVE_API_KEY) return braveSearch(fullQuery, count);
  if (process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_ID) return googleCse(fullQuery, count);
  return [];
}

async function braveSearch(query, count) {
  const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
    params: { q: query, count },
    headers: { Accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_API_KEY },
    timeout: 15000
  });
  return (response.data?.web?.results || []).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.description || ''
  }));
}

async function googleCse(query, count) {
  const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
    params: { key: process.env.GOOGLE_CSE_API_KEY, cx: process.env.GOOGLE_CSE_ID, q: query, num: Math.min(count, 10) },
    timeout: 15000
  });
  return (response.data?.items || []).map(r => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet || ''
  }));
}

function resultToProspect(result, platform) {
  if (!result?.url) return null;
  let username = null;
  let profile_url = null;
  if (platform === 'x') {
    const match = result.url.match(/(?:x\.com|twitter\.com)\/([^/?#]+)/);
    username = match ? match[1] : null;
    if (username && ['search', 'hashtag', 'i', 'explore', 'home', 'settings', 'login'].includes(username.toLowerCase())) return null;
    profile_url = username ? `https://x.com/${username}` : null;
  }
  if (platform === 'facebook') {
    const match = result.url.match(/facebook\.com\/(?:groups\/)?([^/?#]+)/);
    username = match ? match[1] : null;
    if (username && ['watch', 'marketplace', 'gaming', 'events', 'pages', 'login', 'help'].includes(username.toLowerCase())) return null;
    profile_url = username ? `https://facebook.com/${username}` : null;
  }
  if (platform === 'quora') {
    const match = result.url.match(/quora\.com\/profile\/([^/?#]+)/);
    username = match ? match[1].replace(/-/g, ' ') : null;
  }
  return {
    platform,
    platform_id: Buffer.from(result.url).toString('base64').slice(0, 64),
    username,
    profile_url,
    post_url: result.url,
    post_title: String(result.title || '').slice(0, 500),
    post_body: String(result.snippet || '').slice(0, 2000),
    score: 0,
    num_comments: 0,
    created_at: null
  };
}

async function searchWebPlatform(platform, query) {
  const sites = { x: 'x.com', quora: 'quora.com', facebook: 'facebook.com' };
  const results = await webSearch(query, { siteFilter: sites[platform], count: 10 });
  return results.map(r => resultToProspect(r, platform)).filter(Boolean);
}

module.exports = { sleep, searchReddit, searchWebPlatform };
