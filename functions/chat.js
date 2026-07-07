/**
 * WarmPath chat — discuss an event's attendees. Butterbase edge function (Deno).
 * POST JSON: { eventId, messages:[{role,content}], profile? }
 * Returns: { reply }
 * Loads the event's attendees (name + headline) as context, then answers via the AI gateway.
 * Env: NEO4J_HTTP_URL, NEO4J_USER, NEO4J_PASSWORD, BB_API_KEY.
 */

const APP_ID = 'app_5c837gy54kmi';
const MODEL = 'anthropic/claude-sonnet-4.6';

async function cypher(env, statement, parameters = {}) {
  const res = await fetch(env.NEO4J_HTTP_URL, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + btoa(`${env.NEO4J_USER}:${env.NEO4J_PASSWORD}`),
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ statement, parameters }),
  });
  if (!res.ok) throw new Error(`neo4j ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const { fields, values } = j.data;
  return values.map((row) => Object.fromEntries(fields.map((f, i) => [f, row[i]])));
}

async function chat(env, messages) {
  const res = await fetch(`https://api.butterbase.ai/v1/${env.BUTTERBASE_APP_ID || APP_ID}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.BB_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 900, temperature: 0.5 }),
  });
  if (!res.ok) throw new Error(`ai ${res.status}: ${await res.text()}`);
  return (await res.json()).choices?.[0]?.message?.content ?? '';
}

export default async function handler(request, ctx) {
  const env = ctx?.env ?? {};
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    const { eventId, messages = [], profile, runId } = await request.json();
    if (!eventId) return new Response(JSON.stringify({ error: 'missing eventId' }), { status: 400, headers: cors });

    const [ev] = await cypher(env, `MATCH (e:Event {id:$eventId}) RETURN e.name AS name`, { eventId });
    const attendees = await cypher(env,
      `MATCH (:Event {id:$eventId})<-[:ATTENDS]-(p:Person)
       WHERE p.headline IS NOT NULL AND p.headline <> ''
       RETURN p.name AS name, p.headline AS headline
       ORDER BY p.name LIMIT 200`,
      { eventId });

    const roster = attendees.map((a) => `- ${a.name} — ${a.headline}`).join('\n');
    const sys =
      `You are WarmPath's networking assistant for the event "${ev?.name ?? eventId}". ` +
      `You can see this roster of attendees (name — headline):\n${roster}\n\n` +
      (profile ? `The user's background: ${profile}\n\n` : '') +
      `Help the user decide who to meet: answer questions about attendees, group/filter them, spot ` +
      `non-obvious matches, and draft outreach when asked. Be concise and specific; cite attendees by name. ` +
      `If asked about someone not in the roster, say they aren't in the visible attendee list.`;

    const reply = await chat(env, [{ role: 'system', content: sys }, ...messages.slice(-10)]);

    // Persist this exchange to the session thread (best-effort; requires auth + a runId owned by the user).
    try {
      const uid = ctx?.user?.id;
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (uid && runId && ctx?.db && lastUser) {
        const { rows } = await ctx.db.query('SELECT id FROM runs WHERE id = $1 AND user_id = $2', [runId, uid]);
        if (rows[0]) {
          await ctx.db.query(
            'INSERT INTO messages (run_id, user_id, role, content) VALUES ($1,$2,$3,$4),($1,$2,$5,$6)',
            [runId, uid, 'user', lastUser.content, 'assistant', reply],
          );
        }
      }
    } catch (e) { console.error('save message failed:', String(e)); }

    return new Response(JSON.stringify({ reply }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
