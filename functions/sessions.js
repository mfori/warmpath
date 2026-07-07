/**
 * WarmPath sessions — list and reopen a signed-in user's saved event sessions. Butterbase edge function.
 * Auth required (ctx.user populated); reads only the caller's own rows.
 *
 * POST JSON:
 *   { op: "list" }            -> { sessions: [{ runId, eventId, eventName, eventUrl, prefs, totalAttendees, updatedAt }] }
 *   { op: "get", runId }      -> { session: { runId, eventId, eventName, eventUrl, prefs, profile, me,
 *                                             totalAttendees, shortlist, messages:[{role,content}] } }
 *   { op: "delete", runId }   -> { ok: true }
 */
export default async function handler(request, ctx) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

  try {
    const uid = ctx?.user?.id;
    if (!uid) return json({ error: 'login required' }, 401);
    if (!ctx?.db) return json({ error: 'db unavailable' }, 500);

    const body = request.method === 'POST' ? await request.json() : Object.fromEntries(new URL(request.url).searchParams);
    const op = body.op || 'list';

    if (op === 'list') {
      const { rows } = await ctx.db.query(
        `SELECT id, event_id, event_name, event_url, prefs, total_attendees, updated_at
         FROM runs WHERE user_id = $1 ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 100`,
        [uid],
      );
      return json({
        sessions: rows.map((r) => ({
          runId: r.id, eventId: r.event_id, eventName: r.event_name, eventUrl: r.event_url,
          prefs: r.prefs, totalAttendees: r.total_attendees, updatedAt: r.updated_at,
        })),
      });
    }

    if (op === 'get') {
      if (!body.runId) return json({ error: 'runId required' }, 400);
      const { rows } = await ctx.db.query(
        `SELECT id, event_id, event_name, event_url, prefs, profile, me, total_attendees, shortlist
         FROM runs WHERE id = $1 AND user_id = $2`,
        [body.runId, uid],
      );
      const r = rows[0];
      if (!r) return json({ error: 'not found' }, 404);
      const { rows: msgs } = await ctx.db.query(
        'SELECT role, content FROM messages WHERE run_id = $1 ORDER BY created_at ASC, id ASC',
        [r.id],
      );
      // shortlist may come back as parsed JSON or a JSON string depending on the driver.
      let shortlist = r.shortlist;
      if (typeof shortlist === 'string') { try { shortlist = JSON.parse(shortlist); } catch { shortlist = []; } }
      return json({
        session: {
          runId: r.id, eventId: r.event_id, eventName: r.event_name, eventUrl: r.event_url,
          prefs: r.prefs, profile: r.profile, me: r.me, totalAttendees: r.total_attendees,
          shortlist: shortlist || [], messages: msgs.map((m) => ({ role: m.role, content: m.content })),
        },
      });
    }

    if (op === 'delete') {
      if (!body.runId) return json({ error: 'runId required' }, 400);
      await ctx.db.query('DELETE FROM messages WHERE run_id = $1 AND user_id = $2', [body.runId, uid]);
      await ctx.db.query('DELETE FROM runs WHERE id = $1 AND user_id = $2', [body.runId, uid]);
      return json({ ok: true });
    }

    return json({ error: 'unknown op' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}
