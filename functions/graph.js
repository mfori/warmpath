/**
 * WarmPath graph API — Butterbase edge function (Cloudflare Workers-style).
 * Queries Neo4j Aura via its HTTP Query API (Bolt/TCP isn't available on edge).
 *
 * Env vars (set with: butterbase functions env set …):
 *   NEO4J_HTTP_URL   e.g. https://<dbid>.databases.neo4j.io/db/neo4j/query/v2
 *   NEO4J_USER       neo4j
 *   NEO4J_PASSWORD   <password>
 *
 * Endpoints (GET):
 *   ?op=search&q=jane
 *   ?op=warmpath&target=usr-…[&me=usr-…]
 *   ?op=radar&event=evt-…
 *   ?op=superconnectors
 */

const DEFAULT_ME = 'usr-E1vEAZqNVPOAFnf'; // demo "you"

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
  const json = await res.json();
  const { fields, values } = json.data;
  return values.map((row) => Object.fromEntries(fields.map((f, i) => [f, row[i]])));
}

const search = (env, q) =>
  cypher(
    env,
    `MATCH (p:Person) WHERE toLower(p.name) CONTAINS toLower($q)
     OPTIONAL MATCH (p)-[:ATTENDS]->(e:Event)
     RETURN p.id AS id, p.name AS name, p.headline AS headline, p.linkedin AS linkedin,
            count(e) AS events
     ORDER BY events DESC LIMIT 12`,
    { q },
  );

async function warmpath(env, me, target) {
  const rows = await cypher(
    env,
    `MATCH (me:Person {id:$me}), (t:Person {id:$target})
     MATCH path = shortestPath((me)-[:WORKS_AT|WORKED_AT|ATTENDS|SPEAKS_AT*..6]-(t))
     RETURN [n IN nodes(path) | coalesce(n.name, n.id)] AS steps,
            [r IN relationships(path) | type(r)] AS links,
            length(path) AS hops`,
    { me, target },
  );
  return rows[0] ?? null;
}

const radar = (env, event) =>
  cypher(
    env,
    `MATCH (seed:Event {id:$event})<-[:ATTENDS]-(p:Person)-[:ATTENDS]->(e:Event)
     WHERE e.id <> seed.id
     RETURN e.id AS id, e.name AS name, count(DISTINCT p) AS sharedAttendees
     ORDER BY sharedAttendees DESC LIMIT 10`,
    { event },
  );

const events = (env) =>
  cypher(
    env,
    `MATCH (e:Event)<-[:ATTENDS]-(p:Person)
     WITH e, count(p) AS attendees
     RETURN e.id AS id, e.name AS name, attendees ORDER BY attendees DESC`,
  );

const superconnectors = (env) =>
  cypher(
    env,
    `MATCH (p:Person)-[:ATTENDS]->(e:Event)
     WITH p, count(e) AS events WHERE events > 1
     RETURN p.id AS id, p.name AS name, p.headline AS headline, events
     ORDER BY events DESC LIMIT 10`,
  );

export default async function handler(request, ctx) {
  const env = ctx?.env ?? {};
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'content-type': 'application/json',
  };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = new URL(request.url);
  const op = url.searchParams.get('op');
  try {
    let data;
    if (op === 'search') data = await search(env, url.searchParams.get('q') || '');
    else if (op === 'warmpath')
      data = await warmpath(env, url.searchParams.get('me') || DEFAULT_ME, url.searchParams.get('target'));
    else if (op === 'radar') data = await radar(env, url.searchParams.get('event'));
    else if (op === 'events') data = await events(env);
    else if (op === 'superconnectors') data = await superconnectors(env);
    else return new Response(JSON.stringify({ error: 'unknown op' }), { status: 400, headers: cors });
    return new Response(JSON.stringify({ data }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
