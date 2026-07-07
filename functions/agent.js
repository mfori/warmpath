/**
 * WarmPath agent — Butterbase edge function (Deno).
 * Input (GET query or POST JSON): { event, prefs, me? , profile? }
 *   event   — Neo4j Event id (already ingested)
 *   prefs   — free-text: who you want to meet (topics, roles, categories)
 *   profile — optional: your background (e.g. pasted from LinkedIn) for better matching + openers
 *   me      — your Person id (default: demo user)
 * Returns: { event, totalAttendees, shortlist: [{ id, name, headline, why, opener, warmPath }] }
 *
 * Env: NEO4J_HTTP_URL, NEO4J_USER, NEO4J_PASSWORD, BB_API_KEY (Butterbase key for the AI gateway).
 */

const APP_ID = 'app_5c837gy54kmi';
const DEFAULT_ME = 'usr-E1vEAZqNVPOAFnf';
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
  const appId = env.BUTTERBASE_APP_ID || APP_ID;
  const res = await fetch(`https://api.butterbase.ai/v1/${appId}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.BB_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 1600, temperature: 0.4 }),
  });
  if (!res.ok) throw new Error(`ai ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? '';
}

// Bounded 2-hop shared connection (fast; avoids shortestPath supernode blow-up through big event nodes).
// Prefers a shared company, then another event. The current event is never a valid connector — every
// attendee trivially shares it, so "via this event" carries no warm-intro signal and is excluded.
async function warmPath(env, me, target, currentEvent) {
  if (!me || me === target) return null;
  const rows = await cypher(
    env,
    `MATCH (me:Person {id:$me})-[r1:ATTENDS|SPEAKS_AT|WORKS_AT|WORKED_AT]->(x)<-[r2:ATTENDS|SPEAKS_AT|WORKS_AT|WORKED_AT]-(t:Person {id:$target})
     WHERE NOT (x:Event AND x.id = $currentEvent)
     WITH me, t, x, r1, r2, CASE labels(x)[0] WHEN 'Company' THEN 0 ELSE 1 END AS pref
     RETURN me.name AS meName, coalesce(x.name, x.id) AS via, t.name AS tName,
            type(r1) AS l1, type(r2) AS l2
     ORDER BY pref LIMIT 1`,
    { me, target, currentEvent },
  );
  if (!rows.length) return null;
  const r = rows[0];
  return { steps: [r.meName, r.via, r.tName], links: [r.l1, r.l2], hops: 2 };
}

// Ranking runs on a RocketRide Cloud pipeline (via the rr-rank Apify actor -> llm_openai_api node ->
// Butterbase AI gateway). This is the load-bearing RocketRide integration; agent falls back to the
// direct Butterbase gateway only if RocketRide/Apify is unavailable.
async function rankViaRocketRide(env, candidates, prefs, profile) {
  const actor = env.RR_RANK_ACTOR || 'vc2wMI83RBtOqm2Nc';
  const input = {
    candidates: candidates.map((c) => ({ name: c.name, headline: c.headline })),
    prefs, profile,
    bbKey: env.BB_API_KEY, appId: env.BUTTERBASE_APP_ID || APP_ID, rrKey: env.ROCKETRIDE_APIKEY,
  };
  const res = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${env.APIFY_TOKEN}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) },
  );
  if (!res.ok) throw new Error(`rr-rank ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const items = await res.json();
  return parseJsonArray(items?.[0]?.answersRaw || '');
}

function parseJsonArray(text) {
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  if (s === -1 || e === -1) return [];
  try {
    return JSON.parse(text.slice(s, e + 1));
  } catch {
    return [];
  }
}

const PAGE = 8;

async function runAgent(env, { event, prefs, profile, me, exclude }) {
  me = me || DEFAULT_ME;
  const skip = Array.isArray(exclude) ? exclude : [];
  const [evRow] = await cypher(env, `MATCH (e:Event {id:$event}) RETURN e.name AS name`, { event });
  if (!evRow) throw new Error('event not found in graph');
  const [{ total }] = await cypher(
    env,
    `MATCH (:Event {id:$event})<-[:ATTENDS]-(p:Person) RETURN count(p) AS total`,
    { event },
  );

  // candidate pool: attendees with a headline (skip yourself + anyone already shown on earlier pages)
  const candidates = await cypher(
    env,
    `MATCH (:Event {id:$event})<-[:ATTENDS]-(p:Person)
     WHERE p.headline IS NOT NULL AND p.headline <> '' AND p.id <> $me AND NOT p.id IN $skip
     OPTIONAL MATCH (p)-[:ATTENDS]->(e:Event)
     RETURN p.id AS id, p.name AS name, p.headline AS headline, p.linkedin AS linkedin, count(e) AS events
     ORDER BY events DESC LIMIT 400`,
    { event, me, skip },
  );

  const list = candidates.map((c, i) => `${i}) ${c.name} — ${c.headline}`).join('\n');
  const sys =
    'You are a sharp networking assistant. From a list of event attendees, pick the best people for the ' +
    'user to meet given their goal and background. Prefer concrete relevance over seniority. ' +
    'Return ONLY a JSON array (no prose) of up to 8 objects: ' +
    '{"idx": <number from the list>, "why": "<=15 words on why they fit", "opener": "one specific, warm opening line"}.';
  const usr =
    `MY GOAL / WHO I WANT TO MEET:\n${prefs || '(no specific preferences — pick the most relevant builders/founders)'}\n\n` +
    (profile ? `MY BACKGROUND:\n${profile}\n\n` : '') +
    `ATTENDEES:\n${list}`;

  // NOTE: RocketRide ranking (rankViaRocketRide) runs on RocketRide Cloud but takes ~40s — over
  // Butterbase's ~30s synchronous-invocation cap — so it can't run in this sync path. It's wired as an
  // async-polled step instead (see rank-start/rank-status). Live ranking here uses the fast gateway.
  let picks = [];
  try {
    picks = parseJsonArray(await chat(env, [
      { role: 'system', content: sys },
      { role: 'user', content: usr },
    ]));
  } catch (e) {
    console.error('AI ranking failed:', String(e));
  }

  // fallback: if the model returned nothing, use the most-connected candidates
  if (!picks.length) picks = candidates.slice(0, PAGE).map((_, i) => ({ idx: i, why: 'Well-connected across the scene', opener: '' }));

  const shortlist = (await Promise.all(
    picks.slice(0, PAGE).map(async (p) => {
      const c = candidates[p.idx];
      if (!c) return null;
      return {
        id: c.id, name: c.name, headline: c.headline, linkedin: c.linkedin, events: c.events,
        why: p.why || '', opener: p.opener || '',
        warmPath: await warmPath(env, me, c.id, event),
      };
    }),
  )).filter(Boolean);

  // more remain if the eligible pool had candidates beyond the ones we just returned
  const hasMore = candidates.length > shortlist.length;
  return { event: { id: event, name: evRow.name }, totalAttendees: total, shortlist, hasMore };
}

export default async function handler(request, ctx) {
  const env = ctx?.env ?? {};
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'content-type': 'application/json',
  };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    let params;
    if (request.method === 'POST') {
      params = await request.json();
    } else {
      const u = new URL(request.url);
      params = Object.fromEntries(u.searchParams.entries());
    }
    if (!params.event) return new Response(JSON.stringify({ error: 'missing "event"' }), { status: 400, headers: cors });
    const result = await runAgent(env, params);
    // Persist the session for the signed-in user (Butterbase DB). One session per (user, event):
    // re-running the scraper overwrites the shortlist in place but keeps the same run_id, so the
    // attached chat thread survives. Returns runId so the client can attach chat + saves.
    try {
      const uid = ctx?.user?.id;
      if (uid && ctx?.db) {
        // "Load more" pages send an exclude list — append the new batch onto the stored shortlist
        // (deduped by id) rather than replacing it, so the reopened session shows everyone.
        const isAppend = Array.isArray(params.exclude) && params.exclude.length > 0;
        const { rows } = await ctx.db.query(
          'SELECT id, shortlist FROM runs WHERE user_id = $1 AND event_id = $2',
          [uid, result.event.id],
        );
        const existing = rows[0];
        let stored = result.shortlist || [];
        if (isAppend && existing) {
          let prev = existing.shortlist;
          if (typeof prev === 'string') { try { prev = JSON.parse(prev); } catch { prev = []; } }
          prev = Array.isArray(prev) ? prev : [];
          const seen = new Set(prev.map((p) => p.id));
          stored = prev.concat((result.shortlist || []).filter((p) => !seen.has(p.id)));
        }
        const vals = [
          result.event.name, params.eventUrl || null, params.prefs || '',
          params.profile || '', params.me || null, result.totalAttendees, JSON.stringify(stored),
        ];
        if (existing) {
          await ctx.db.query(
            `UPDATE runs SET event_name=$2, event_url=$3, prefs=$4, profile=$5, me=$6,
                             total_attendees=$7, shortlist=$8::jsonb, updated_at=now()
             WHERE id=$1`,
            [existing.id, ...vals],
          );
          result.runId = existing.id;
        } else {
          const ins = await ctx.db.query(
            `INSERT INTO runs (user_id, event_id, event_name, event_url, prefs, profile, me, total_attendees, shortlist)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING id`,
            [uid, result.event.id, ...vals],
          );
          result.runId = ins.rows[0]?.id ?? null;
        }
      }
    } catch (e) { console.error('save run failed:', String(e)); }
    return new Response(JSON.stringify(result), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
