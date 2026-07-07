/**
 * WarmPath deep re-rank (poll) — checks the RocketRide Cloud ranking run; when done, assembles the
 * shortlist (maps picks -> people + warm paths). Butterbase edge function, auth required.
 * POST JSON: { rankRunId, datasetId, candidates:[{id,name,headline,linkedin}], me, event }
 * Returns while running: { done:false, status }; when done: { done:true, shortlist }
 * Env: NEO4J_*, APIFY_TOKEN.
 */
async function cypher(env, statement, parameters = {}) {
  const res = await fetch(env.NEO4J_HTTP_URL, {
    method: 'POST',
    headers: { authorization: 'Basic ' + btoa(`${env.NEO4J_USER}:${env.NEO4J_PASSWORD}`), 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ statement, parameters }),
  });
  if (!res.ok) throw new Error(`neo4j ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const { fields, values } = j.data;
  return values.map((row) => Object.fromEntries(fields.map((f, i) => [f, row[i]])));
}

async function warmPath(env, me, target, currentEvent) {
  if (!me || me === target) return null;
  const rows = await cypher(env,
    `MATCH (me:Person {id:$me})-[r1:ATTENDS|SPEAKS_AT|WORKS_AT|WORKED_AT]->(x)<-[r2:ATTENDS|SPEAKS_AT|WORKS_AT|WORKED_AT]-(t:Person {id:$target})
     WHERE NOT (x:Event AND x.id = $currentEvent)
     WITH me, t, x, r1, r2, CASE labels(x)[0] WHEN 'Company' THEN 0 ELSE 1 END AS pref
     RETURN me.name AS meName, coalesce(x.name, x.id) AS via, t.name AS tName, type(r1) AS l1, type(r2) AS l2
     ORDER BY pref LIMIT 1`,
    { me, target, currentEvent });
  if (!rows.length) return null;
  const r = rows[0];
  return { steps: [r.meName, r.via, r.tName], links: [r.l1, r.l2], hops: 2 };
}

function parseJsonArray(t) {
  const s = t.indexOf('['), e = t.lastIndexOf(']');
  if (s === -1 || e === -1) return [];
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return []; }
}

export default async function handler(request, ctx) {
  const env = ctx?.env ?? {};
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    if (!ctx?.user?.id) return new Response(JSON.stringify({ error: 'login required' }), { status: 401, headers: cors });
    const { rankRunId, datasetId, candidates = [], me, event } = await request.json();
    if (!rankRunId || !datasetId) throw new Error('rankRunId and datasetId required');

    const runRes = await fetch(`https://api.apify.com/v2/actor-runs/${rankRunId}?token=${env.APIFY_TOKEN}`);
    const status = (await runRes.json()).data?.status;

    if (status === 'SUCCEEDED') {
      const items = await (await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${env.APIFY_TOKEN}`)).json();
      const picks = parseJsonArray(items?.[0]?.answersRaw || '');
      const shortlist = (await Promise.all(
        picks.slice(0, 8).map(async (p) => {
          const c = candidates[p.idx];
          if (!c) return null;
          return { ...c, why: p.why || '', opener: p.opener || '', warmPath: await warmPath(env, me, c.id, event) };
        }),
      )).filter(Boolean);
      return new Response(JSON.stringify({ done: true, shortlist, engine: 'RocketRide Cloud' }), { headers: cors });
    }
    if (['FAILED', 'ABORTED', 'TIMED-OUT', 'TIMED_OUT'].includes(status)) {
      return new Response(JSON.stringify({ done: true, error: `RocketRide run ${status}` }), { headers: cors });
    }
    return new Response(JSON.stringify({ done: false, status }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
