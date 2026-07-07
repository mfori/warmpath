import { run, close, toNum } from '../src/lib/neo4j.js';
import { eventRadar, warmPath } from '../src/queries.js';

const ME = process.argv[2] ?? 'usr-E1vEAZqNVPOAFnf'; // Martin Forejt

const one = async (cypher: string, key: string) => toNum((await run(cypher))[0]?.get(key));

console.log('=== Graph counts ===');
console.log('people:   ', await one('MATCH (p:Person) RETURN count(p) AS n', 'n'));
console.log('events:   ', await one('MATCH (e:Event) RETURN count(e) AS n', 'n'));
console.log('organizers:', await one('MATCH (o:Organizer) RETURN count(o) AS n', 'n'));
console.log('companies:', await one('MATCH (c:Company) RETURN count(c) AS n', 'n'));
console.log('ATTENDS:  ', await one('MATCH ()-[r:ATTENDS]->() RETURN count(r) AS n', 'n'));

console.log('\n=== Super-connectors (attend the most events) ===');
for (const r of await run(
  `MATCH (p:Person)-[:ATTENDS]->(e:Event)
   WITH p, count(e) AS events WHERE events > 1
   RETURN p.id AS id, p.name AS name, events ORDER BY events DESC LIMIT 6`,
)) console.log(`  ${r.get('name')} — ${toNum(r.get('events'))} events  (${r.get('id')})`);

console.log('\n=== Event Radar (events the same crowd attends) ===');
const seed = (await run('MATCH (e:Event) RETURN e.id AS id, e.name AS name ORDER BY e.name LIMIT 1'))[0];
console.log(`seed: ${seed.get('name')}`);
console.table(await eventRadar(seed.get('id')));

console.log('\n=== WarmPath from you ===');
const me = (await run('MATCH (p:Person {id:$id}) RETURN p.name AS name', { id: ME }))[0];
console.log('you:', me ? me.get('name') : '(not found)');
// pick a target: a well-connected person who is not you
const target = (await run(
  `MATCH (p:Person)-[:ATTENDS]->(e:Event)
   WHERE p.id <> $me
   WITH p, count(e) AS ev ORDER BY ev DESC LIMIT 1
   RETURN p.id AS id, p.name AS name`,
  { me: ME },
))[0];
if (target) {
  const tId = target.get('id');
  console.log('target:', target.get('name'), `(${tId})`);
  const wp = await warmPath(ME, tId);
  if (wp) {
    const parts = [wp.steps[0]];
    wp.links.forEach((l, i) => parts.push(`-[${l}]-> ${wp.steps[i + 1]}`));
    console.log(`  path (${wp.hops} hops): ${parts.join(' ')}`);
  } else console.log('  no path found');
}
await close();
