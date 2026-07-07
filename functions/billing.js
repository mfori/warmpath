/**
 * WarmPath billing — entitlement status + Stripe Checkout. Butterbase edge function (auth required).
 * POST JSON:
 *   { op: "status" }   -> { runsUsed, freeLimit, subscribed }
 *   { op: "checkout", successUrl, cancelUrl } -> { url }   (Stripe Checkout link)
 * Env: PLAN_ID (Butterbase billing plan id), BUTTERBASE_APP_ID (platform-injected).
 */

const APP_ID = 'app_5c837gy54kmi';
const FREE_LIMIT = 3;

async function isSubscribed(app, authHeader) {
  try {
    const r = await fetch(`https://api.butterbase.ai/v1/${app}/billing/subscription`, { headers: { authorization: authHeader } });
    if (!r.ok) return false;
    const j = await r.json();
    const status = j?.status || j?.subscription?.status;
    return status === 'active' || status === 'trialing' || j?.active === true;
  } catch { return false; }
}

export default async function handler(request, ctx) {
  const env = ctx?.env ?? {};
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const uid = ctx?.user?.id;
    if (!uid) return new Response(JSON.stringify({ error: 'login required' }), { status: 401, headers: cors });
    const authHeader = request.headers.get('authorization') || '';
    const app = env.BUTTERBASE_APP_ID || APP_ID;
    const body = request.method === 'POST' ? await request.json() : {};
    const op = body.op || 'status';

    if (op === 'status') {
      const { rows } = await ctx.db.query('SELECT count(*)::int AS c FROM runs WHERE user_id = $1', [uid]);
      const subscribed = await isSubscribed(app, authHeader);
      return new Response(JSON.stringify({ runsUsed: rows[0]?.c ?? 0, freeLimit: FREE_LIMIT, subscribed }), { headers: cors });
    }

    if (op === 'checkout') {
      if (!env.PLAN_ID) return new Response(JSON.stringify({ error: 'no plan configured yet' }), { status: 400, headers: cors });
      const r = await fetch(`https://api.butterbase.ai/v1/${app}/billing/subscribe`, {
        method: 'POST',
        headers: { authorization: authHeader, 'content-type': 'application/json' },
        body: JSON.stringify({ planId: env.PLAN_ID, successUrl: body.successUrl, cancelUrl: body.cancelUrl }),
      });
      const j = await r.json();
      if (!r.ok) return new Response(JSON.stringify({ error: j.error || j.message || 'checkout failed' }), { status: 400, headers: cors });
      return new Response(JSON.stringify({ url: j.url || j.checkoutUrl }), { headers: cors });
    }

    return new Response(JSON.stringify({ error: 'unknown op' }), { status: 400, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
