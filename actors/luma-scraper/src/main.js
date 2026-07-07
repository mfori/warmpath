import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset, log } from '@crawlee/playwright';
import { extractFromLuma, getInitialData, getTicketKey, getEventApiId } from './extract.js';

/**
 * Luma Event & Guest Scraper
 * Extraction logic (verified against real pages) lives in ./extract.js.
 *  - event / organizers (hosts) / topics (categories): public, no login
 *  - description: page <meta name="description">
 *  - FULL guest list: api.luma.com/event/get-guest-list, paginated, using the logged-in cookie +
 *    the ticket_key found in the page's guest_data (present only for events you're registered to).
 *    Without a ticket_key we fall back to the ~10 public featured_guests.
 */

const GUEST_LIST_URL = 'https://api.luma.com/event/get-guest-list';

/** Parse "a=1; b=2" into Playwright cookie objects scoped to lu.ma + luma.com. */
function parseCookie(cookieStr) {
  const pairs = (cookieStr || '')
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf('=');
      return { name: pair.slice(0, idx).trim(), value: pair.slice(idx + 1).trim() };
    })
    .filter((c) => c.name);
  // set on both domains the app uses
  return pairs.flatMap((c) => [
    { ...c, domain: '.lu.ma', path: '/' },
    { ...c, domain: '.luma.com', path: '/' },
  ]);
}

/** Paginate the full guest list via the API, reusing the browser session cookies. */
async function fetchAllGuests(request, eventApiId, ticketKey, { maxGuests = 5000 } = {}) {
  const users = [];
  let cursor = null;
  for (let i = 0; i < 100; i++) {
    const url = new URL(GUEST_LIST_URL);
    url.searchParams.set('event_api_id', eventApiId);
    url.searchParams.set('pagination_limit', '100');
    url.searchParams.set('ticket_key', ticketKey);
    if (cursor) url.searchParams.set('pagination_cursor', cursor);

    const res = await request.get(url.toString(), { headers: { accept: 'application/json' } });
    if (!res.ok()) {
      log.warning(`guest-list HTTP ${res.status()} — stopping (got ${users.length} so far)`);
      break;
    }
    const json = await res.json();
    for (const entry of json.entries || []) users.push(entry.user || entry);
    if (!json.has_more || !json.next_cursor || users.length >= maxGuests) break;
    cursor = json.next_cursor;
  }
  return users;
}

await Actor.init();
const input = (await Actor.getInput()) || {};
const { eventUrls = [], lumaCookie = '', scrapeGuests = true, maxEvents = 50 } = input;

if (!eventUrls.length) {
  log.warning('No eventUrls provided — nothing to scrape.');
  await Actor.exit();
}

const cookies = parseCookie(lumaCookie);
let debugged = false;

const crawler = new PlaywrightCrawler({
  maxRequestsPerCrawl: maxEvents,
  requestHandlerTimeoutSecs: 120,
  preNavigationHooks: [
    async ({ page }) => {
      if (cookies.length) {
        await page.context().addCookies(cookies).catch((e) => log.warning(`cookie set failed: ${e.message}`));
      }
    },
  ],
  requestHandler: async ({ page, request }) => {
    await page.waitForLoadState('networkidle').catch(() => {});

    const nextData = await page
      .evaluate(() => {
        const el = document.getElementById('__NEXT_DATA__');
        return el ? JSON.parse(el.textContent || 'null') : null;
      })
      .catch(() => null);

    const metaDescription = await page
      .evaluate(() => document.querySelector('meta[name="description"]')?.getAttribute('content') || '')
      .catch(() => '');

    if (!debugged) {
      debugged = true;
      log.info(`DEBUG initialData.data keys: ${Object.keys(getInitialData(nextData) || {}).join(', ') || 'none'}`);
    }

    const ticketKey = getTicketKey(nextData);
    const eventApiId = getEventApiId(nextData);

    let guestUsers = [];
    if (scrapeGuests && ticketKey && eventApiId) {
      guestUsers = await fetchAllGuests(page.context().request, eventApiId, ticketKey);
      log.info(`  fetched ${guestUsers.length} guests via ticket_key`);
    } else if (scrapeGuests) {
      log.info('  no ticket_key (not registered to this event) — using public featured_guests only');
    }

    const result = extractFromLuma({ nextData, url: request.url, metaDescription, guestUsers });
    if (!result) {
      log.warning(`Could not extract event from ${request.url} — check DEBUG logs.`);
      return;
    }

    await Dataset.pushData(result);
    log.info(
      `✓ ${result.event.name} — ${result.guests.length}/${result.coverage.guestCount} guests ` +
        `(fullList=${result.coverage.fetchedFullList}), ${result.event.organizers.length} organizers`,
    );
  },
});

await crawler.run(eventUrls.map((url) => ({ url })));
await Actor.exit();
