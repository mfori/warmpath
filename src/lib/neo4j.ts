import neo4j, { type QueryResult } from 'neo4j-driver';
import 'dotenv/config';

const { NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD } = process.env;

if (!NEO4J_URI || !NEO4J_USER || !NEO4J_PASSWORD) {
  throw new Error('Missing NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD in .env');
}

export const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
);

/** Run a Cypher statement and return the records. */
export async function run(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<QueryResult['records']> {
  const session = driver.session();
  try {
    const res = await session.run(cypher, params);
    return res.records;
  } finally {
    await session.close();
  }
}

/** Neo4j returns Integer objects; coerce to a JS number safely. */
export function toNum(v: unknown): number {
  if (v == null) return 0;
  // neo4j.Integer has toNumber(); plain numbers pass through
  return typeof v === 'number' ? v : (v as { toNumber?: () => number }).toNumber?.() ?? Number(v);
}

export async function close(): Promise<void> {
  await driver.close();
}
