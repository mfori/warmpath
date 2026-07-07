/**
 * WarmPath saved targets — save / list / remove. Butterbase edge function, auth required.
 * POST JSON:
 *   { runId?, person:{ id, name, headline, opener } }   -> save (deduped per user+person) -> { ok:true }
 *   { op: "list" }                                        -> { saved: [...] }
 *   { op: "remove", personId }                            -> { ok:true }
 */
export default async function handler(request, ctx) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const uid = ctx?.user?.id;
    if (!uid) return new Response(JSON.stringify({ error: 'login required' }), { status: 401, headers: cors });
    const body = await request.json();
    const op = body.op || 'save';

    if (op === 'list') {
      const { rows } = await ctx.db.query(
        `SELECT DISTINCT ON (person_id) person_id, person_name, headline, opener, created_at
         FROM saved_targets WHERE user_id = $1 ORDER BY person_id, created_at DESC`,
        [uid],
      );
      rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return new Response(JSON.stringify({ saved: rows }), { headers: cors });
    }

    if (op === 'remove') {
      await ctx.db.query('DELETE FROM saved_targets WHERE user_id = $1 AND person_id = $2', [uid, body.personId]);
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    const { runId, person } = body;
    if (!person?.id) return new Response(JSON.stringify({ error: 'person required' }), { status: 400, headers: cors });
    // Dedupe: only insert if this user hasn't already saved this person.
    await ctx.db.query(
      `INSERT INTO saved_targets (user_id, run_id, person_id, person_name, headline, opener)
       SELECT $1,$2,$3,$4,$5,$6
       WHERE NOT EXISTS (SELECT 1 FROM saved_targets WHERE user_id = $1 AND person_id = $3)`,
      [uid, runId || null, person.id, person.name || null, person.headline || null, person.opener || null],
    );
    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
