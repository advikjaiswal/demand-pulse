const assert = require('assert');
const { hashPassword, verifyPassword, normalizeEmail } = require('../src/auth');
const { parseWorkspace, buildQueries } = require('../src/keywords');
const { scorePost, enrichPost } = require('../src/score');
const { parseDuckDuckGoHtml } = require('../src/sources');
const { founderNumberFor, planForFounderNumber, canRunScan } = require('../src/entitlements');

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
  post_title: 'Looking for the best trusted IVF clinic recommendations in Bangalore?',
  post_body: "I'm worried and struggling to choose. Has anyone had a good experience with egg freezing consultations, and what did it cost?",
  score: 9,
  num_comments: 6
};

const score = scorePost(post, workspace);
assert(score >= 65, `expected hot score, got ${score}`);
const enriched = enrichPost(post, workspace, 'ivf recommendation bangalore');
assert.strictEqual(enriched.quality, 'hot');
assert.strictEqual(enriched.is_question, true);
assert(enriched.pain_point.includes('best trusted IVF'));
assert.strictEqual(scorePost({ post_title: 'IVF jobs in Bangalore', post_body: '' }, workspace), 0);

const ddg = parseDuckDuckGoHtml(`
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.quora.com%2FHow-do-I-choose-an-IVF-clinic">How do I choose an IVF clinic?</a>
    <a class="result__snippet">People compare cost, trust, and doctor experience.</a>
  </div>
`);
assert.strictEqual(ddg.length, 1);
assert.strictEqual(ddg[0].url, 'https://www.quora.com/How-do-I-choose-an-IVF-clinic');
assert(ddg[0].title.includes('IVF clinic'));

assert.strictEqual(founderNumberFor(0), 1);
assert.strictEqual(founderNumberFor(49), 50);
assert.strictEqual(founderNumberFor(50), null);
assert.strictEqual(planForFounderNumber(7), 'founder_free');
assert.strictEqual(planForFounderNumber(null), 'payment_pending');
assert.strictEqual(canRunScan({ plan: 'founder_free' }, 0).ok, true);
assert.strictEqual(canRunScan({ plan: 'founder_free' }, 25).ok, false);
assert.strictEqual(canRunScan({ plan: 'payment_pending' }, 0).ok, false);

console.log('core tests passed');
