import { eventRadar } from '../src/queries.js';
import { close } from '../src/lib/neo4j.js';

// Usage: npm run q:radar -- <seedEventId>   (default: evt-x)
const seedId = process.argv[2] ?? 'evt-x';
const events = await eventRadar(seedId);
console.log(`Event Radar for "${seedId}":`);
console.table(events);
await close();
