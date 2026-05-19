const QUESTION_OPENERS = [
  'how ', 'why ', 'what ', 'when ', 'where ', 'which ', 'who ',
  'should i', 'can i', 'does anyone', 'has anyone', 'looking for',
  'recommend', 'suggest', 'need help', 'any advice'
];

const PAIN_TERMS = [
  'stuck', 'struggling', 'confused', 'worried', 'anxious', 'afraid', 'fear',
  'problem', 'issue', 'blocked', 'not working', 'failed', 'frustrated',
  'lost', 'desperate', 'need help', 'why am i', 'how do i'
];

const BUYER_TERMS = [
  'recommend', 'consultant', 'expert', 'service', 'agency', 'coach', 'book',
  'price', 'cost', 'paid', 'hire', 'where can i', 'who can', 'best',
  'legit', 'trusted', 'worth it', 'report', 'reading', 'audit'
];

const PROMO_TERMS = [
  'dm me', 'contact me', 'my service', 'i offer', 'limited offer', 'whatsapp me',
  'buy now', 'discount', 'link in bio', 'subscribe', 'check out my'
];

const LEARNER_TERMS = ['course', 'learn', 'tutorial', 'homework', 'assignment', 'beginner', 'how to learn'];
const SKEPTIC_TERMS = ['scam', 'fake', 'does it work', 'is it real', 'skeptic', 'bullshit', 'fraud'];

function postText(post) {
  return `${post.post_title || ''} ${post.post_body || ''}`.trim();
}

function isQuestion(text) {
  const lower = String(text || '').toLowerCase();
  return lower.includes('?') || QUESTION_OPENERS.some(op => lower.includes(op));
}

function countMatches(lower, terms) {
  return terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
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

function scoreBreakdown(post, workspace = {}) {
  const text = postText(post);
  const lower = text.toLowerCase();
  if (!lower) {
    return {
      topic_score: 0,
      pain_score: 0,
      buyer_intent_score: 0,
      content_value_score: 0,
      engagement_score: 0,
      freshness_score: 0,
      spam_noise_score: 100
    };
  }

  const terms = [workspace.niche, workspace.business_type, ...(workspace.services || [])]
    .filter(Boolean)
    .map(s => String(s).toLowerCase());
  const blocked = (workspace.blocked_terms || []).filter(Boolean).map(s => String(s).toLowerCase());
  const topicHits = terms.filter(term => lower.includes(term)).length;
  const firstPerson = /\b(i|i'm|ive|i've|my|me|we|our)\b/i.test(text);
  const question = isQuestion(text);
  const painHits = countMatches(lower, PAIN_TERMS);
  const buyerHits = countMatches(lower, BUYER_TERMS);
  const promoHits = countMatches(lower, PROMO_TERMS);
  const learnerHits = countMatches(lower, LEARNER_TERMS);
  const blockedHits = blocked.filter(term => lower.includes(term)).length;
  if (blockedHits) {
    return {
      topic_score: 0,
      pain_score: 0,
      buyer_intent_score: 0,
      content_value_score: 0,
      engagement_score: 0,
      freshness_score: 0,
      spam_noise_score: 100
    };
  }

  const created = post.created_at ? new Date(post.created_at) : null;
  const ageDays = created && !Number.isNaN(created.getTime()) ? (Date.now() - created.getTime()) / 86400000 : 30;

  return {
    topic_score: clamp(topicHits * 28 + (workspace.geography && lower.includes(String(workspace.geography).toLowerCase()) ? 12 : 0) + (topicHits ? 25 : 8)),
    pain_score: clamp(painHits * 18 + (firstPerson ? 18 : 0) + (question ? 12 : 0)),
    buyer_intent_score: clamp(buyerHits * 18 + (/recommend|best|legit|trusted|hire|book|cost|price/i.test(text) ? 22 : 0)),
    content_value_score: clamp((question ? 25 : 0) + (text.length > 80 ? 18 : 0) + (painHits ? 18 : 0) + (buyerHits ? 14 : 0)),
    engagement_score: clamp(Math.min((post.num_comments || 0) * 6, 45) + Math.min((post.score || 0) * 2, 35)),
    freshness_score: clamp(ageDays <= 2 ? 95 : ageDays <= 7 ? 78 : ageDays <= 30 ? 55 : 25),
    spam_noise_score: clamp(promoHits * 32 + learnerHits * 16 + blockedHits * 60 + (/http\S+.*http\S+/i.test(text) ? 18 : 0))
  };
}

function finalDemandScore(scores) {
  return clamp(
    scores.pain_score * 0.25 +
    scores.buyer_intent_score * 0.25 +
    scores.content_value_score * 0.18 +
    scores.topic_score * 0.12 +
    scores.engagement_score * 0.08 +
    scores.freshness_score * 0.07 -
    scores.spam_noise_score * 0.25
  );
}

function classifyPost(post, scores) {
  const lower = postText(post).toLowerCase();
  if (scores.spam_noise_score >= 65) return 'spam';
  if (countMatches(lower, PROMO_TERMS) >= 1) return 'provider_promoter';
  if (scores.pain_score >= 60 && scores.buyer_intent_score >= 45) return 'real_buyer_problem';
  if (scores.content_value_score >= 65 && scores.pain_score >= 45) return 'strong_content_opportunity';
  if (countMatches(lower, SKEPTIC_TERMS) >= 1) return 'skeptic';
  if (countMatches(lower, LEARNER_TERMS) >= 1 && scores.buyer_intent_score < 35) return 'learner_hobbyist';
  if (scores.topic_score < 35 || scores.content_value_score < 30) return 'broad_irrelevant_chatter';
  return 'content_opportunity';
}

function scorePost(post, workspace = {}) {
  return finalDemandScore(scoreBreakdown(post, workspace));
}

function quality(score) {
  if (score >= 65) return 'hot';
  if (score >= 35) return 'warm';
  return 'cold';
}

function enrichPost(post, workspace, keyword) {
  const scores = scoreBreakdown(post, workspace);
  const relevance = finalDemandScore(scores);
  const classification = classifyPost(post, scores);
  const topic = topicFor(post, workspace);
  const pain = painPoint(post.post_title, post.post_body);
  const buyer = scores.buyer_intent_score >= 60;
  const format = buyer ? 'Reel + Blog + Direct Reply' : scores.content_value_score >= 65 ? 'Reel + Blog + Quora Answer' : 'Short Post + Question Bank';
  return {
    ...post,
    keyword,
    relevance,
    quality: quality(relevance),
    ...scores,
    post_type: classification,
    is_best: scores.topic_score >= 45 && scores.pain_score >= 45 && scores.content_value_score >= 45 && scores.spam_noise_score <= 45 && relevance >= 35,
    topic,
    is_question: isQuestion(postText(post)),
    pain_point: pain,
    intent: scores.buyer_intent_score >= 60 ? 'Looking for paid help' : scores.pain_score >= 55 ? 'Looking for guidance' : scores.content_value_score >= 55 ? 'Researching options' : 'Low intent',
    audience_segment: inferAudience(post, workspace),
    funnel_stage: scores.buyer_intent_score >= 65 ? 'Decision' : scores.pain_score >= 55 ? 'Consideration' : 'Awareness',
    service_match: inferService(post, workspace),
    content_angle: buildContentAngle(topic, pain || post.post_title),
    recommended_format: format,
    cta: buyer ? `Invite them to book ${inferService(post, workspace)}` : `Save this as a ${format.split('+')[0].trim()} topic`,
    confidence: clamp((relevance + scores.content_value_score + (100 - scores.spam_noise_score)) / 3)
  };
}

function inferService(post, workspace) {
  const lower = postText(post).toLowerCase();
  for (const service of workspace.services || []) {
    if (lower.includes(String(service).toLowerCase())) return service;
  }
  return workspace.services?.[0] || workspace.niche || 'Core offer';
}

function inferAudience(post, workspace) {
  const lower = postText(post).toLowerCase();
  if (/founder|startup|business|company|brand/i.test(lower)) return 'Founder / business owner';
  if (/career|job|salary|work|promotion/i.test(lower)) return 'Working professional';
  if (/baby|child|parent/i.test(lower)) return 'Parent / family buyer';
  if (/client|agency|marketing|seo/i.test(lower)) return 'Agency / marketer';
  return workspace.business_type ? `${workspace.business_type} buyer` : 'Niche service buyer';
}

function buildContentAngle(topic, pain) {
  const label = String(topic || 'market pain').replace(/_/g, ' ');
  if (!pain) return `What people misunderstand about ${label}`;
  const cleaned = String(pain).replace(/\?+$/, '').slice(0, 120);
  return cleaned.match(/^(how|why|what|should|can|does)/i)
    ? cleaned + '?'
    : `Can ${label} explain this: ${cleaned}?`;
}

module.exports = {
  isQuestion, painPoint, topicFor, scorePost, quality, enrichPost,
  scoreBreakdown, finalDemandScore, classifyPost
};
