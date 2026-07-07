import { run, toNum } from './lib/neo4j.js';

export interface EventRec {
  id: string;
  name: string;
  sharedAttendees: number;
  sharedOrgs: number;
}

export interface WarmPathResult {
  steps: string[];
  links: string[];
  hops: number;
}

/** Event Radar — recommend events "the same crowd goes to" (shared attendees), then shared organizers. */
export async function eventRadar(seedId: string): Promise<EventRec[]> {
  const recs = await run(
    `MATCH (seed:Event {id:$seedId})<-[:ATTENDS]-(p:Person)-[:ATTENDS]->(e:Event)
     WHERE e.id <> seed.id
     WITH seed, e, count(DISTINCT p) AS sharedAttendees
     OPTIONAL MATCH (seed)<-[:ORGANIZES]-(o:Organizer)-[:ORGANIZES]->(e)
     RETURN e.id AS id, e.name AS name,
            sharedAttendees,
            count(DISTINCT o) AS sharedOrgs
     ORDER BY sharedAttendees DESC, sharedOrgs DESC
     LIMIT 10`,
    { seedId },
  );
  return recs.map((r) => ({
    id: r.get('id'),
    name: r.get('name'),
    sharedAttendees: toNum(r.get('sharedAttendees')),
    sharedOrgs: toNum(r.get('sharedOrgs')),
  }));
}

/** WarmPath — shortest warm-intro chain between two people. */
export async function warmPath(
  meId: string,
  targetId: string,
): Promise<WarmPathResult | null> {
  const recs = await run(
    `MATCH (me:Person {id:$meId}), (target:Person {id:$targetId})
     MATCH path = shortestPath(
       (me)-[:WORKS_AT|WORKED_AT|ATTENDS|SPEAKS_AT*..6]-(target)
     )
     RETURN [n IN nodes(path) | coalesce(n.name, n.id)] AS steps,
            [r IN relationships(path) | type(r)]        AS links,
            length(path)                                AS hops`,
    { meId, targetId },
  );
  if (recs.length === 0) return null;
  const r = recs[0];
  return {
    steps: r.get('steps'),
    links: r.get('links'),
    hops: toNum(r.get('hops')),
  };
}
