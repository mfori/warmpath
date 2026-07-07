import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ApifyClient } from 'apify-client';
import 'dotenv/config';
import { run, close } from './lib/neo4j.js';

/** Normalized shape produced by the luma-scraper actor (and the sample file). */
interface LumaRecord {
  event: {
    id: string;
    url?: string;
    name: string;
    description?: string;
    startAt?: string | null;
    location?: string | null;
    topics?: string[];
    organizers?: { id: string; name: string; url?: string | null }[];
  };
  guests?: {
    id: string;
    name: string;
    headline?: string | null;
    linkedin?: string | null;
    twitter?: string | null;
    website?: string | null;
  }[];
  coverage?: { attendeesVisible: boolean; fetchedFullList?: boolean; guestCount?: number };
}

const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Pull a company out of a headline like "Eng at Stripe" / "Founder @ Plain, prev. Netflix". */
function companyFromHeadline(headline?: string | null): string | null {
  if (!headline) return null;
  const m = headline.match(/(?:@|\bat\b)\s+([^,;|·\n]+)/i);
  const company = m?.[1]?.trim();
  return company && company.length >= 2 && company.length <= 40 ? company : null;
}

async function loadRecords(): Promise<LumaRecord[]> {
  if (process.argv.includes('--apify')) {
    const token = process.env.APIFY_TOKEN;
    const datasetId = process.env.LUMA_DATASET_ID;
    if (!token || !datasetId) throw new Error('Set APIFY_TOKEN and LUMA_DATASET_ID for --apify');
    const client = new ApifyClient({ token });
    const { items } = await client.dataset(datasetId).listItems();
    return items as unknown as LumaRecord[];
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const path = process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : join(here, '..', 'data', 'luma.sample.json');
  return JSON.parse(readFileSync(path, 'utf8')) as LumaRecord[];
}

/** Run a query over rows in chunks, with a small retry for transient Aura drops. */
async function batched(cypher: string, rows: Record<string, unknown>[], chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await run(cypher, { rows: slice });
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    if (lastErr) throw lastErr;
  }
}

const records = await loadRecords();
console.log(`Building graph from ${records.length} event record(s)…`);

// De-dupe everything in memory first, then bulk-upsert.
const events = new Map<string, Record<string, unknown>>();
const topics = new Map<string, string>();
const organizers = new Map<string, { name: string; url: string | null }>();
const persons = new Map<string, Record<string, unknown>>();
const companies = new Map<string, string>();
const aboutEdges: Record<string, unknown>[] = [];
const orgEdges: Record<string, unknown>[] = [];
const attendsEdges: Record<string, unknown>[] = [];
const worksAtEdges: Record<string, unknown>[] = [];

for (const rec of records) {
  const e = rec.event;
  events.set(e.id, {
    id: e.id, name: e.name, description: e.description ?? '',
    startAt: e.startAt ?? null, location: e.location ?? null, url: e.url ?? null,
  });
  for (const t of e.topics ?? []) {
    const tid = slug(t);
    topics.set(tid, t);
    aboutEdges.push({ eid: e.id, tid });
  }
  for (const o of e.organizers ?? []) {
    const oid = o.id || slug(o.name);
    organizers.set(oid, { name: o.name, url: o.url ?? null });
    orgEdges.push({ eid: e.id, oid });
  }
  for (const g of rec.guests ?? []) {
    const pid = g.id || slug(g.name);
    persons.set(pid, {
      id: pid, name: g.name, headline: g.headline ?? null,
      linkedin: g.linkedin ?? null, twitter: g.twitter ?? null, website: g.website ?? null,
    });
    attendsEdges.push({ pid, eid: e.id });
    const company = companyFromHeadline(g.headline);
    if (company) {
      const cid = slug(company);
      companies.set(cid, company);
      worksAtEdges.push({ pid, cid });
    }
  }
}

console.log(
  `  ${events.size} events, ${organizers.size} organizers, ${topics.size} topics, ` +
    `${persons.size} people, ${companies.size} companies`,
);

await batched(
  `UNWIND $rows AS r MERGE (e:Event {id:r.id})
   SET e.name=r.name, e.description=r.description, e.startAt=r.startAt, e.location=r.location, e.url=r.url`,
  [...events.values()],
);
await batched(`UNWIND $rows AS r MERGE (t:Topic {id:r.id}) SET t.name=r.name`,
  [...topics].map(([id, name]) => ({ id, name })));
await batched(`UNWIND $rows AS r MERGE (o:Organizer {id:r.id}) SET o.name=r.name, o.url=r.url`,
  [...organizers].map(([id, v]) => ({ id, name: v.name, url: v.url })));
await batched(`UNWIND $rows AS r MERGE (c:Company {id:r.id}) SET c.name=r.name`,
  [...companies].map(([id, name]) => ({ id, name })));
await batched(
  `UNWIND $rows AS r MERGE (p:Person {id:r.id})
   SET p.name=r.name, p.headline=r.headline, p.linkedin=r.linkedin, p.twitter=r.twitter, p.website=r.website`,
  [...persons.values()],
);

console.log('  nodes done — linking relationships…');
await batched(`UNWIND $rows AS r MATCH (e:Event {id:r.eid}),(t:Topic {id:r.tid}) MERGE (e)-[:ABOUT]->(t)`, aboutEdges);
await batched(`UNWIND $rows AS r MATCH (o:Organizer {id:r.oid}),(e:Event {id:r.eid}) MERGE (o)-[:ORGANIZES]->(e)`, orgEdges);
await batched(`UNWIND $rows AS r MATCH (p:Person {id:r.pid}),(e:Event {id:r.eid}) MERGE (p)-[:ATTENDS]->(e)`, attendsEdges);
await batched(`UNWIND $rows AS r MATCH (p:Person {id:r.pid}),(c:Company {id:r.cid}) MERGE (p)-[:WORKS_AT]->(c)`, worksAtEdges);

console.log(`✅ Done. ${attendsEdges.length} attendance + ${orgEdges.length} organizer edges.`);
await close();
