const FREE_USER_LIMIT = parseInt(process.env.DEMAND_FREE_USER_LIMIT || '50', 10);
const FREE_SCAN_LIMIT = parseInt(process.env.DEMAND_FREE_SCAN_LIMIT || '25', 10);

function founderNumberFor(existingFounderCount) {
  const next = Number(existingFounderCount || 0) + 1;
  return next <= FREE_USER_LIMIT ? next : null;
}

function planForFounderNumber(founder_number) {
  return founder_number ? 'founder_free' : 'payment_pending';
}

function planLabel(user = {}) {
  if (user.plan === 'founder_free') return user.founder_number ? `Free founder #${user.founder_number}` : 'Free founder';
  if (user.plan === 'paid') return 'Paid';
  return 'Payment pending';
}

function canRunScan(user = {}, scansUsed = 0) {
  if (user.role === 'admin' || user.plan === 'paid') return { ok: true, remaining: null };
  if (user.plan !== 'founder_free') {
    return { ok: false, remaining: 0, reason: 'Your account is outside the first free 50. Payment will open soon.' };
  }
  const remaining = Math.max(0, FREE_SCAN_LIMIT - Number(scansUsed || 0));
  if (remaining <= 0) {
    return { ok: false, remaining: 0, reason: `Free founder accounts include ${FREE_SCAN_LIMIT} scans per 30 days.` };
  }
  return { ok: true, remaining, limit: FREE_SCAN_LIMIT };
}

module.exports = { FREE_USER_LIMIT, FREE_SCAN_LIMIT, founderNumberFor, planForFounderNumber, planLabel, canRunScan };
