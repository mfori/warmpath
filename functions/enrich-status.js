/**
 * WarmPath LinkedIn enrichment (poll) — when the actor finishes, writes company + richer headline into
 * Neo4j (Person.company, Person.headline, WORKS_AT -> Company). Butterbase edge function, auth required.
 * POST JSON: { enrichRunId, datasetId, handleToId }
 * Returns while running: { done:false, status }; when done: { done:true, enriched:[{id,name,company,headline}] }
 * Env: NEO4J_*, APIFY_TOKEN.
 */
const slug = (s = '') => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const handleOf = (u) => String(u || '').replace(/^https?:\/\/[^/]*\/in\//i, '').replace(/^\/?in\//i, '').replace(/^\/+|\/+$/g, '').toLowerCase();

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
    const { enrichRunId, datasetId, handleToId = {} } = await request.json();
    if (!enrichRunId || !datasetId) throw new Error('enrichRunId and datasetId required');

    const status = (await (await fetch(`https://api.apify.com/v2/actor-runs/${enrichRunId}?token=${env.APIFY_TOKEN}`)).json()).data?.status;
    if (['FAILED', 'ABORTED', 'TIMED-OUT', 'TIMED_OUT'].includes(status)) {
      return new Response(JSON.stringify({ done: true, error: `enrichment ${status}` }), { headers: cors });
    }
    if (status !== 'SUCCEEDED') return new Response(JSON.stringify({ done: false, status }), { headers: cors });

    const items = await (await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${env.APIFY_TOKEN}`)).json();
    const enriched = [];
    for (const it of Array.isArray(items) ? items : []) {
      const h = (it.public_identifier || handleOf(it.url) || '').toLowerCase();
      const id = handleToId[h];
      if (!id) continue;
      const company = it.company_name || null;
      const headline = it.headline || null;
      await cypher(env,
        `MATCH (p:Person {id:$id}) SET p.headline = coalesce($headline, p.headline), p.company = $company`,
        { id, headline, company });
      if (company) {
        await cypher(env,
          `MERGE (c:Company {id:$cid}) SET c.name=$company
           WITH c MATCH (p:Person {id:$id}) MERGE (p)-[:WORKS_AT]->(c)`,
          { cid: slug(company), company, id });
      }
      enriched.push({ id, name: it.full_name || null, company, headline });
    }
    return new Response(JSON.stringify({ done: true, enriched }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
