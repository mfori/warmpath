/**
 * WarmPath deep re-rank (start) — kicks off ranking on RocketRide Cloud (via the rr-rank Apify actor),
 * async so it isn't bound by the ~30s sync cap. Butterbase edge function, auth required.
 * POST JSON: { event, prefs, profile, me }
 * Returns: { rankRunId, datasetId, candidates:[{id,name,headline,linkedin}], me }
 * Env: NEO4J_*, BB_API_KEY, APIFY_TOKEN, ROCKETRIDE_APIKEY, RR_RANK_ACTOR.
 */
const APP_ID = 'app_5c837gy54kmi';

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

export default async function handler(request, ctx) {
  const env = ctx?.env ?? {};
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    if (!ctx?.user?.id) return new Response(JSON.stringify({ error: 'login required' }), { status: 401, headers: cors });
    const { event, prefs = '', profile = '', me } = await request.json();
    if (!event) return new Response(JSON.stringify({ error: 'missing event' }), { status: 400, headers: cors });

    const candidates = await cypher(env,
      `MATCH (:Event {id:$event})<-[:ATTENDS]-(p:Person)
       WHERE p.headline IS NOT NULL AND p.headline <> '' AND (p.id <> $me OR $me IS NULL)
       OPTIONAL MATCH (p)-[:ATTENDS]->(e:Event)
       RETURN p.id AS id, p.name AS name, p.headline AS headline, p.linkedin AS linkedin, count(e) AS events
       ORDER BY events DESC LIMIT 120`,
      { event, me: me || null });

    const actor = env.RR_RANK_ACTOR || 'vc2wMI83RBtOqm2Nc';
    const input = {
      candidates: candidates.map((c) => ({ name: c.name, headline: c.headline })),
      prefs, profile,
      bbKey: env.BB_API_KEY, appId: env.BUTTERBASE_APP_ID || APP_ID, rrKey: env.ROCKETRIDE_APIKEY,
    };
    const res = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?token=${env.APIFY_TOKEN}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`apify start ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const { data } = await res.json();

    return new Response(JSON.stringify({
      rankRunId: data.id, datasetId: data.defaultDatasetId,
      candidates: candidates.map((c) => ({ id: c.id, name: c.name, headline: c.headline, linkedin: c.linkedin, events: c.events })),
      me: me || null,
    }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
