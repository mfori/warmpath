# luma-scraper (Apify actor)

Scrapes Luma event metadata (name, description, topics, **organizers** — always visible) and, when run
with a logged-in cookie, the **guest list** (only on events that expose it). Outputs the normalized
WarmPath record shape consumed by `../../src/ingest.ts`.

## Output shape (one item per event)
```json
{
  "event": { "id": "...", "url": "...", "name": "...", "description": "...", "startAt": "...",
             "location": "...", "topics": ["..."], "organizers": [{"id":"...","name":"...","url":"..."}] },
  "guests": [{ "id": "...", "name": "...", "headline": "..." }],
  "coverage": { "attendeesVisible": true }
}
```

## Deploy to Apify
```bash
npm i -g apify-cli        # if needed
apify login               # paste your API token
cd actors/luma-scraper
apify push                # builds the Docker image + deploys the actor
```
Then set `LUMA_ACTOR_ID` (e.g. `yourname~luma-scraper`) in the project `.env`.

## Run
- **Input:** `eventUrls` (required), `lumaCookie` (for guests), `scrapeGuests`, `maxEvents`.
- **Get the cookie:** log into lu.ma → DevTools → Application → Cookies → copy the cookie header as
  `name=value; name=value`. Paste into the `lumaCookie` input (marked secret).
- After a run, copy the run's **default dataset id** into `LUMA_DATASET_ID` and run `npm run ingest:apify`.

## Verified against real pages (July 2026)
Extraction (`src/extract.js`) is confirmed against live lu.ma pages — HackwithBay 3.0, a 500-guest Notion
event, and a Google design meetup. It reads `initialData.data` = `{ event, hosts[], featured_guests[],
guest_count, categories[] }`:
- **event / organizers / topics** — always available, no login (organizers = `hosts`, topics = `categories`).
- **guests (FULL list)** — pulled from `api.luma.com/event/get-guest-list`, paginated (`pagination_cursor`
  / `has_more`, 100/page), using the logged-in cookie **plus a `ticket_key`**. The `ticket_key` is read
  automatically from the page's `guest_data.ticket_key`, which is present **only for events you're
  registered to**. Verified July 2026: pulled all **208/208** guests of a registered event, 199 with a
  `linkedin_handle`. Each guest carries name, `bio_short` (headline), and socials (linkedin/twitter/website).
  - **To get all attendees of an event, register to it first** (one click on Luma) so the page carries a
    ticket_key. Without one (not registered), the actor falls back to the ~10 public `featured_guests`.
  - Passing the cookie via the `luma.…` values also works on `.luma.com` (the actor sets it on both domains).
- **description** — from the page `<meta name="description">` (not in the event object).

Confidence: event/organizer/topic/featured-guest paths are tested end-to-end (real browser run). The
authenticated full-guest-list capture is coded defensively but only fires with a live cookie — verify it
on your first logged-in run via the DEBUG logs (we print `initialData.data` keys + captured api.lu.ma URLs).

## First-run note
If Luma changes its payload and extraction returns empty, the DEBUG log lines show the current
`initialData.data` keys and captured api.lu.ma URLs — adjust `src/extract.js` accordingly.

Local run (needs Playwright/Chromium): `apify run` from this dir, or run on the platform (recommended —
the base image has the browser preinstalled).
