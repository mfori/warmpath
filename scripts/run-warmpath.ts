import { warmPath } from '../src/queries.js';
import { close } from '../src/lib/neo4j.js';

// Usage: npm run q:warmpath -- <meId> <targetId>   (default: me -> founder)
const meId = process.argv[2] ?? 'me';
const targetId = process.argv[3] ?? 'founder';

const result = await warmPath(meId, targetId);
if (!result) {
  console.log(`No warm path found from "${meId}" to "${targetId}".`);
} else {
  console.log(`Warm path (${result.hops} hops):`);
  // e.g. You -[WORKED_AT]-> Stripe -[WORKED_AT]-> Ana -[ATTENDS]-> Event -[ATTENDS]-> Jordan
  const parts: string[] = [result.steps[0]];
  result.links.forEach((link, i) => parts.push(`-[${link}]-> ${result.steps[i + 1]}`));
  console.log('  ' + parts.join(' '));
}
await close();
