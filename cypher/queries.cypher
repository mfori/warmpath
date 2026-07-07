// WarmPath — the two hero queries. Paste into Neo4j Browser to demo the graph directly.

// ---------- Event Radar ----------
// "People who went to this event also go to…" — recommend by shared attendees, then shared organizers.
// (Shared attendees is a far richer signal than Luma's sparse categories.)
// :param seedId => 'evt-x'
MATCH (seed:Event {id:$seedId})<-[:ATTENDS]-(p:Person)-[:ATTENDS]->(e:Event)
WHERE e.id <> seed.id
WITH seed, e, count(DISTINCT p) AS sharedAttendees
OPTIONAL MATCH (seed)<-[:ORGANIZES]-(o:Organizer)-[:ORGANIZES]->(e)
RETURN e.id AS id, e.name AS name,
       sharedAttendees,
       count(DISTINCT o) AS sharedOrgs
ORDER BY sharedAttendees DESC, sharedOrgs DESC
LIMIT 10;

// ---------- WarmPath (the wow) ----------
// Shortest warm-intro chain between you and a target, through shared companies/events.
// :param meId => 'me'
// :param targetId => 'founder'
MATCH (me:Person {id:$meId}), (target:Person {id:$targetId})
MATCH path = shortestPath(
  (me)-[:WORKS_AT|WORKED_AT|ATTENDS|SPEAKS_AT*..6]-(target)
)
RETURN path;

// Same query, serialized for an app/agent (names + relationship types + hop count):
MATCH (me:Person {id:$meId}), (target:Person {id:$targetId})
MATCH path = shortestPath(
  (me)-[:WORKS_AT|WORKED_AT|ATTENDS|SPEAKS_AT*..6]-(target)
)
RETURN [n IN nodes(path) | coalesce(n.name, n.id)] AS steps,
       [r IN relationships(path) | type(r)]        AS links,
       length(path)                                AS hops;
