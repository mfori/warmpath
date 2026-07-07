import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { run, close } from '../src/lib/neo4j.js';

const here = dirname(fileURLToPath(import.meta.url));
const cypherDir = join(here, '..', 'cypher');

/** Split a .cypher file into individual statements, dropping // comments and blanks. */
function statements(file: string): string[] {
  const raw = readFileSync(join(cypherDir, file), 'utf8');
  return raw
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function apply(file: string) {
  const stmts = statements(file);
  console.log(`\n${file}: ${stmts.length} statements`);
  for (const s of stmts) {
    await run(s);
    process.stdout.write('.');
  }
  console.log(' done');
}

await apply('schema.cypher');
// Pass --no-seed to skip the demo data (e.g. once you've ingested real Luma data).
if (!process.argv.includes('--no-seed')) await apply('seed.cypher');

console.log('\n✅ Schema applied.');
await close();
