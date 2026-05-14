const QUESTION_OPENERS = [
  'how ', 'why ', 'what ', 'when ', 'where ', 'which ', 'who ',
  'should i', 'can i', 'does anyone', 'has anyone', 'looking for',
  'recommend', 'suggest', 'need help', 'any advice'
];

function postText(post) {
  return `${post.post_title || ''} ${post.post_body || ''}`.trim();
}

function isQuestion(text) {
  const lower = String(text || '').toLowerCase();
  return lower.includes('?') || QUESTION_OPENERS.some(op => lower.includes(op));
}

function painPoint(title, body) {
  const candidates = [];
  const push = value => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length >= 8 && text.length <= 260) candidates.push(text);
  };
  push(title);
  String(body || '').split(/(?<=[.?!])\s+/).forEach(push);
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const score = s => (s.includes('?') ? 10 : 0) + (/\b(i|my|me|we|our)\b/i.test(s) ? 4 : 0) + (s.length < 140 ? 2 : 0);
    return score(b) - score(a);
  });
  return candidates[0];
}

function topicFor(post, workspace) {
  const lower = postText(post).toLowerCase();
  for (const service of workspace.services || []) {
    const term = String(service || '').trim();
    if (term && lower.includes(term.toLowerCase())) {
      return term.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    }
  }
  return String(workspace.niche || workspace.business_type || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'general';
}

function scorePost(post, workspace = {}) {
  const text = postText(post);
  const lower = text.toLowerCase();
  if (!lower) return 0;
  for (const blocked of workspace.blocked_terms || []) {
    if (blocked && lower.includes(String(blocked).toLowerCase())) return 0;
  }

  const terms = [workspace.niche, workspace.business_type, ...(workspace.services || [])].filter(Boolean).map(s => String(s).toLowerCase());
  let score = 8;
  score += Math.min(terms.filter(term => lower.includes(term)).length * 16, 42);
  if (isQuestion(text)) score += 18;
  if (/\b(looking for|recommend|need help|struggling|confused|best|any advice|worth it)\b/i.test(text)) score += 16;
  if (workspace.geography && lower.includes(String(workspace.geography).toLowerCase())) score += 8;
  if ((post.num_comments || 0) > 3) score += 6;
  if ((post.score || 0) > 5) score += 4;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function quality(score) {
  if (score >= 65) return 'hot';
  if (score >= 35) return 'warm';
  return 'cold';
}

function enrichPost(post, workspace, keyword) {
  const relevance = scorePost(post, workspace);
  return {
    ...post,
    keyword,
    relevance,
    quality: quality(relevance),
    topic: topicFor(post, workspace),
    is_question: isQuestion(postText(post)),
    pain_point: painPoint(post.post_title, post.post_body)
  };
}

module.exports = { isQuestion, painPoint, topicFor, scorePost, quality, enrichPost };
