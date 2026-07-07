# WarmPath

Graph-native networking agent for HackwithBay 3.0. Discover relevant events, then find your **shortest
warm-intro path** to the people you want to meet — over a Neo4j relationship graph an agent traverses.

Mandatory stack: **Neo4j** (the graph + shortest-path/community), **RocketRide Cloud** (the deployed agent
pipeline), **Butterbase** (DB + auth + payment). **Apify** ingests Luma data. **Cognee** (bonus) = memory.

## Quick start (de-risk order)

```bash
cp .env.example .env      # fill Neo4j + Apify creds
npm install

# 1) prove connectivity
npm run ping:neo4j
npm run ping:apify

# 2) load schema + demo graph, then run the two hero queries
npm run db:schema
npm run q:radar                    # Event Radar for evt-x
npm run q:warmpath                 # warm path: me -> founder  (You -> Stripe -> Ana -> Event -> Jordan)

# 3) ingest real data (local frozen file first, then Apify dataset)
npm run ingest                     # loads data/luma.sample.json
npm run ingest:apify               # loads LUMA_DATASET_ID from a finished actor run
```

Open the graph in Neo4j Browser and run `cypher/queries.cypher` for the live demo visual.

## Layout
- `cypher/` — `schema.cypher`, `seed.cypher` (demo graph), `queries.cypher` (the two hero queries).
- `src/lib/neo4j.ts` — driver + helpers.
- `src/queries.ts` — `eventRadar()` / `warmPath()` (used by the app + the RocketRide pipeline).
- `src/ingest.ts` — Luma records → Neo4j upserts (local file or Apify dataset).
- `scripts/` — smoke tests, schema apply, query runners.
- `actors/luma-scraper/` — custom Apify actor (deploy this). See its README.
- `data/luma.sample.json` — frozen demo dataset (also documents the record shape).

## Next (not yet scaffolded)
- **RocketRide Cloud pipeline** — wrap the planner + `queries.ts` traversals + LLM synthesis; deploy to
  cloud.rocketride.ai; put the endpoint in `ROCKETRIDE_ENDPOINT`.
- **Butterbase** — auth + DB + AI gateway + the mandatory payment gate.
- **Frontend** — goal input, Event Radar list, graph view with the warm path highlighted.
