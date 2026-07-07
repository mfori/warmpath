/**
 * WarmPath LinkedIn enrichment (start) — kicks off the anchor/linkedin-profile-enrichment Apify actor
 * for the given people (async). Butterbase edge function, auth required.
 * POST JSON: { personIds: [...] }
 * Returns: { enrichRunId, datasetId, handleToId, count }
 * Env: NEO4J_*, APIFY_TOKEN, LI_ACTOR (default anchor~linkedin-profile-enrichment).
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

const handleOf = (li) => String(li || '').replace(/^https?:\/\/[^/]*\/in\//i, '').replace(/^\/?in\//i, '').replace(/^\/+|\/+$/g, '').toLowerCase();

export default async function handler(request, ctx) {
  const env = ctx?.env ?? {};
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    if (!ctx?.user?.id) return new Response(JSON.stringify({ error: 'login required' }), { status: 401, headers: cors });
    const { personIds = [] } = await request.json();
    if (!personIds.length) return new Response(JSON.stringify({ error: 'personIds required' }), { status: 400, headers: cors });

    const rows = await cypher(env,
      `MATCH (p:Person) WHERE p.id IN $ids AND p.linkedin IS NOT NULL AND p.linkedin <> ''
       RETURN p.id AS id, p.linkedin AS linkedin`, { ids: personIds });

    const handleToId = {};
    const startUrls = [];
    for (const r of rows) {
      const h = handleOf(r.linkedin);
      if (!h || handleToId[h]) continue;
      handleToId[h] = r.id;
      startUrls.push({ url: `https://www.linkedin.com/in/${h}` });
    }
    if (!startUrls.length) return new Response(JSON.stringify({ error: 'none of these have a LinkedIn handle' }), { status: 400, headers: cors });

    const actor = env.LI_ACTOR || 'anchor~linkedin-profile-enrichment';
    const res = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?token=${env.APIFY_TOKEN}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startUrls }),
    });
    if (!res.ok) throw new Error(`apify start ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const { data } = await res.json();
    return new Response(JSON.stringify({ enrichRunId: data.id, datasetId: data.defaultDatasetId, handleToId, count: startUrls.length }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
