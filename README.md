# WarmPath

**Work the room before you walk in.** Paste a Luma event you're attending, say who you want to meet, and WarmPath scrapes the attendees, **enriches them from LinkedIn**, **ranks them with AI**, and shows your **warmest intro path** to the people worth meeting — then lets you chat about the room and save targets.

🔗 Live: **https://warmpath.butterbase.dev**

## How it works

1. **Scrape** the event's attendees from Luma (custom Apify actor, using your logged-in session).
2. **Enrich** each attendee from **LinkedIn** (Apify) → real title, **company**, richer headline.
3. **Rank** them with AI against your goal + background — the ranking runs on **RocketRide Cloud**.
4. **Store the graph in Neo4j** — people, events, and companies as nodes. Because every event you search
   is saved, WarmPath **knows when an attendee also showed up at other events you've searched**, and
   finds warm-intro paths through shared events / employers.
5. **Everything else lives in Butterbase** — auth, your saved sessions/chats/people, the AI gateway, and
   the app itself.

## The three mandatory technologies (all load-bearing)

### 🕸️ Neo4j — the relationship graph
Attendees, events, and companies are nodes; `ATTENDS` / `WORKS_AT` are edges. The agent traverses it with
Cypher: **`shortestPath`** for warm intros ("you both worked at Stripe" / "you both went to last month's
event") and **shared-attendee** queries to recommend related events. Every searched event is persisted,
so the graph accumulates cross-event overlap — that's what makes warm paths possible.

### 🧈 Butterbase — the backend
The entire product runs on Butterbase: **auth** (login required), **database** (searched sessions, chat
threads, saved people — per user), the **AI gateway** (Claude, for ranking/openers/chat), **payments**
(Stripe Connect subscription tier), and **hosting** (static frontend + all serverless edge functions).

### 🚀 RocketRide Cloud — the AI ranking pipeline
The attendee-ranking pipeline (`chat → llm_openai_api → response_answers`) is **deployed to RocketRide
Cloud** and invoked by the app (via an Apify actor bridge) as a "Deep re-rank." Its LLM node points at
**Butterbase's gateway**, so RocketRide and Butterbase are composed in a single pipeline.

## Also
- **Apify** (our edge): the custom Luma scraper, LinkedIn enrichment, and the RocketRide bridge.
- **Data flow:** Luma → Apify (scrape + LinkedIn enrich) → Neo4j (graph) → RocketRide Cloud (rank) →
  Butterbase (auth, storage, AI gateway, serving).

## Notes
- Full attendee lists require being **registered** to the event (Luma gates the guest list).
- **Monetization is fully built and ready** — a "WarmPath Pro" plan, a Butterbase billing/checkout edge
  function, a free-tier usage meter, and an "Upgrade to Pro" flow are all wired end-to-end. It just
  **can't be activated**: Butterbase payouts run on **Stripe Connect, whose onboarding is restricted to
  US residents**, and our team is non-US. So the payment integration is code-complete up to the Stripe
  onboarding step — everything before that works.
