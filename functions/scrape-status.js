/**
 * WarmPath scrape-status — poll a live scrape started by /run; ingest into Neo4j when it finishes.
 * Butterbase edge function (Deno).
 * POST JSON: { runId, datasetId }
 * Returns while running: { done:false, status }
 *         when finished:  { done:true, event, totalAttendees, withLinkedIn, withHeadline, fetchedFullList }
 *         on failure:     { done:true, error }
 * Env: APIFY_TOKEN, NEO4J_HTTP_URL, NEO4J_USER, NEO4J_PASSWORD.
 */

const slug = (s = '') => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

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
async function batched(env, statement, rows, chunk = 300) {
  for (let i = 0; i < rows.length; i += chunk) await cypher(env, statement, { rows: rows.slice(i, i + chunk) });
}
function companyFromHeadline(h) {
  if (!h) return null;
  const m = h.match(/(?:@|\bat\b)\s+([^,;|·\n]+)/i);
  const c = m?.[1]?.trim();
  return c && c.length >= 2 && c.length <= 40 ? c : null;
}

async function ingest(env, rec) {
  const e = rec.event;
  await cypher(env, `MERGE (e:Event {id:$id}) SET e.name=$name, e.url=$url, e.startAt=$startAt, e.description=$description`,
    { id: e.id, name: e.name, url: e.url ?? null, startAt: e.startAt ?? null, description: e.description ?? '' });
  const orgs = (e.organizers || []).map((o) => ({ id: o.id || slug(o.name), name: o.name, eid: e.id }));
  await batched(env, `UNWIND $rows AS r MERGE (o:Organizer {id:r.id}) SET o.name=r.name
                      WITH r MATCH (e:Event {id:r.eid}),(o:Organizer {id:r.id}) MERGE (o)-[:ORGANIZES]->(e)`, orgs);
  const people = (rec.guests || []).map((g) => ({
    id: g.id || slug(g.name), name: g.name, headline: g.headline ?? null, linkedin: g.linkedin ?? null, twitter: g.twitter ?? null,
    company: companyFromHeadline(g.headline), eid: e.id,
  }));
  await batched(env, `UNWIND $rows AS r MERGE (p:Person {id:r.id})
     SET p.name=r.name, p.headline=r.headline, p.linkedin=r.linkedin, p.twitter=r.twitter
     WITH r MATCH (p:Person {id:r.id}),(e:Event {id:r.eid}) MERGE (p)-[:ATTENDS]->(e)`, people);
  const withCo = people.filter((p) => p.company).map((p) => ({ pid: p.id, cid: slug(p.company), cname: p.company }));
  await batched(env, `UNWIND $rows AS r MERGE (c:Company {id:r.cid}) SET c.name=r.cname
     WITH r MATCH (p:Person {id:r.pid}),(c:Company {id:r.cid}) MERGE (p)-[:WORKS_AT]->(c)`, withCo);
}

export default async function handler(request, ctx) {
  const env = ctx?.env ?? {};
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    const { runId, datasetId } = request.method === 'POST' ? await request.json() : Object.fromEntries(new URL(request.url).searchParams);
    if (!runId || !datasetId) throw new Error('runId and datasetId are required');

    const runRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${env.APIFY_TOKEN}`);
    if (!runRes.ok) throw new Error(`apify run ${runRes.status}`);
    const status = (await runRes.json()).data?.status;

    if (status === 'SUCCEEDED') {
      const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${env.APIFY_TOKEN}`);
      const items = await itemsRes.json();
      const rec = Array.isArray(items) ? items[0] : null;
      if (!rec || !rec.event) return new Response(JSON.stringify({ done: true, error: 'No data — event not found, or attendees hidden for this event/cookie.' }), { headers: cors });
      await ingest(env, rec);
      const eid = rec.event.id;
      const [stats] = await cypher(env,
        `MATCH (:Event {id:$eid})<-[:ATTENDS]-(p:Person)
         RETURN count(p) AS total, count(p.linkedin) AS withLinkedIn,
                count(CASE WHEN p.headline IS NOT NULL AND p.headline <> '' THEN 1 END) AS withHeadline`, { eid });
      return new Response(JSON.stringify({
        done: true, event: { id: eid, name: rec.event.name },
        totalAttendees: stats.total, withLinkedIn: stats.withLinkedIn, withHeadline: stats.withHeadline,
        fetchedFullList: !!rec.coverage?.fetchedFullList,
      }), { headers: cors });
    }

    if (['FAILED', 'ABORTED', 'TIMED-OUT', 'TIMED_OUT'].includes(status)) {
      return new Response(JSON.stringify({ done: true, error: `Scrape ${status}` }), { headers: cors });
    }
    return new Response(JSON.stringify({ done: false, status }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
