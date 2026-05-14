const assert = require('assert');
const { hashPassword, verifyPassword, normalizeEmail } = require('../src/auth');
const { parseWorkspace, buildQueries } = require('../src/keywords');
const { scorePost, enrichPost } = require('../src/score');

const hash = hashPassword('correct horse battery staple');
assert(verifyPassword('correct horse battery staple', hash));
assert(!verifyPassword('wrong password', hash));
assert.strictEqual(normalizeEmail('  Founder@Example.COM '), 'founder@example.com');

const workspace = parseWorkspace({
  name: 'Bright Clinic',
  business_type: 'clinic',
  niche: 'fertility clinic',
  geography: 'Bangalore',
  services: 'ivf, egg freezing',
  competitors: 'Nova IVF',
  blocked_terms: 'jobs'
});

const queries = buildQueries(workspace, { limit: 5 });
assert.strictEqual(queries.length, 5);
assert(queries.some(q => q.toLowerCase().includes('ivf')));
assert(queries.some(q => q.toLowerCase().includes('bangalore')));

const post = {
  platform: 'reddit',
  post_title: 'Looking for IVF clinic recommendations in Bangalore?',
  post_body: 'Has anyone had a good experience with egg freezing consultations?',
  score: 9,
  num_comments: 6
};

const score = scorePost(post, workspace);
assert(score >= 65, `expected hot score, got ${score}`);
const enriched = enrichPost(post, workspace, 'ivf recommendation bangalore');
assert.strictEqual(enriched.quality, 'hot');
assert.strictEqual(enriched.is_question, true);
assert(enriched.pain_point.includes('Looking for IVF'));
assert.strictEqual(scorePost({ post_title: 'IVF jobs in Bangalore', post_body: '' }, workspace), 0);

console.log('core tests passed');
