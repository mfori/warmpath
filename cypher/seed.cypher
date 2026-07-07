// WarmPath — small demo graph so the queries work before any scraping.
// Storyline: You worked at Stripe; so did Ana; Ana attends "SF AI Agents Night";
// so does Jordan (the founder you want to meet). Warm path: You -> Stripe -> Ana -> Event -> Jordan.

// Topics
MERGE (:Topic {id:'ai-agents', name:'AI Agents'});
MERGE (:Topic {id:'devtools', name:'Developer Tools'});

// Companies
MERGE (:Company {id:'stripe', name:'Stripe'});
MERGE (:Company {id:'targetco', name:'TargetCo'});

// Organizer
MERGE (:Organizer {id:'sfai', name:'SF AI Collective'});

// Events
MERGE (:Event {id:'evt-x', name:'SF AI Agents Night', description:'Monthly AI agents meetup', startAt:'2026-07-10T18:00:00Z'});
MERGE (:Event {id:'evt-y', name:'Graph + Agents Hack Social', description:'graph databases and agents', startAt:'2026-07-15T18:00:00Z'});
MERGE (:Event {id:'evt-z', name:'Devtools Happy Hour', description:'developer tooling mixer', startAt:'2026-07-12T18:00:00Z'});

// People
MERGE (:Person {id:'me', name:'You'});
MERGE (:Person {id:'ana', name:'Ana Rios', headline:'Engineer at Stripe'});
MERGE (:Person {id:'founder', name:'Jordan Lee', headline:'Founder at TargetCo'});

// Work history (warm-path fuel)
MATCH (me:Person{id:'me'}),(c:Company{id:'stripe'}) MERGE (me)-[:WORKED_AT]->(c);
MATCH (a:Person{id:'ana'}),(c:Company{id:'stripe'}) MERGE (a)-[:WORKED_AT]->(c);
MATCH (f:Person{id:'founder'}),(c:Company{id:'targetco'}) MERGE (f)-[:WORKS_AT]->(c);

// Attendance (note: 'me' does NOT attend evt-x, so the shortest path routes through Ana)
MATCH (a:Person{id:'ana'}),(e:Event{id:'evt-x'}) MERGE (a)-[:ATTENDS]->(e);
MATCH (f:Person{id:'founder'}),(e:Event{id:'evt-x'}) MERGE (f)-[:ATTENDS]->(e);

// Event Radar structure (topics + shared organizer)
MATCH (e:Event{id:'evt-x'}),(t:Topic{id:'ai-agents'}) MERGE (e)-[:ABOUT]->(t);
MATCH (e:Event{id:'evt-y'}),(t:Topic{id:'ai-agents'}) MERGE (e)-[:ABOUT]->(t);
MATCH (e:Event{id:'evt-z'}),(t:Topic{id:'devtools'}) MERGE (e)-[:ABOUT]->(t);
MATCH (o:Organizer{id:'sfai'}),(e:Event{id:'evt-x'}) MERGE (o)-[:ORGANIZES]->(e);
MATCH (o:Organizer{id:'sfai'}),(e:Event{id:'evt-y'}) MERGE (o)-[:ORGANIZES]->(e);
