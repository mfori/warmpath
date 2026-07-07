import { run, close } from '../src/lib/neo4j.js';

// Smoke test: prove the Aura instance is reachable.
const recs = await run('RETURN 1 AS ok');
console.log('✅ Neo4j connected. RETURN 1 =>', recs[0].get('ok').toNumber?.() ?? recs[0].get('ok'));
await close();
