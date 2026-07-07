/**
 * WarmPath save — persist a target the signed-in user wants to meet. Butterbase edge function.
 * Auth: required (ctx.user populated). POST JSON: { runId?, person:{ id, name, headline, opener } }
 * Returns: { ok: true } | { error }
 */
export default async function handler(request, ctx) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const uid = ctx?.user?.id;
    if (!uid) return new Response(JSON.stringify({ error: 'login required' }), { status: 401, headers: cors });
    const { runId, person } = await request.json();
    if (!person?.id) return new Response(JSON.stringify({ error: 'person required' }), { status: 400, headers: cors });
    await ctx.db.query(
      'INSERT INTO saved_targets (user_id, run_id, person_id, person_name, headline, opener) VALUES ($1,$2,$3,$4,$5,$6)',
      [uid, runId || null, person.id, person.name || null, person.headline || null, person.opener || null],
    );
    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
