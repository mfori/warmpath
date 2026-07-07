/**
 * Pure extraction logic for Luma pages — no browser deps, so it's unit-testable.
 * Verified against real lu.ma __NEXT_DATA__ + api.luma.com guest-list (July 2026):
 *   initialData.data = { event, hosts[], featured_guests[], categories[], guest_data, guest_count, ... }
 *   event     = { api_id, name, start_at, geo_address_info, show_guest_list, url, ... }  (no description)
 *   guest_data.ticket_key = the logged-in user's ticket for THIS event (present iff registered)
 *   host/guest user = { api_id:'usr-…', first_name, last_name, name, bio_short, avatar_url,
 *                       linkedin_handle, twitter_handle, website, username }
 * Full attendee list comes from api.luma.com/event/get-guest-list (needs cookie + ticket_key);
 * see fetchAllGuests() in main.js. Description = page <meta name="description">.
 */

export const slug = (s = '') =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const fullName = (o = {}) =>
  o.name || [o.first_name, o.last_name].filter(Boolean).join(' ').trim() || null;

const looksLikeEvent = (o) =>
  o && typeof o === 'object' && typeof o.name === 'string' &&
  (o.start_at || o.start_at_utc || o.startAt || o.starts_at) != null;

function deepFind(obj, pred, out = [], seen = new Set(), depth = 0) {
  if (!obj || typeof obj !== 'object' || seen.has(obj) || depth > 12) return out;
  seen.add(obj);
  if (pred(obj)) out.push(obj);
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') deepFind(v, pred, out, seen, depth + 1);
  }
  return out;
}

export function getInitialData(nextData) {
  const pp = nextData?.props?.pageProps;
  return pp?.initialData?.data ?? pp?.initialData ?? null;
}

/** The logged-in user's ticket for this event (present only when registered). */
export function getTicketKey(nextData) {
  return getInitialData(nextData)?.guest_data?.ticket_key ?? null;
}

export function getEventApiId(nextData) {
  const d = getInitialData(nextData) || {};
  return d.event?.api_id ?? d.api_id ?? null;
}

export function normPerson(o = {}) {
  return {
    id: o.api_id || slug(fullName(o) || ''),
    name: fullName(o),
    headline: o.bio_short || o.headline || o.job_title || null,
    linkedin: o.linkedin_handle || null,
    twitter: o.twitter_handle || null,
    website: o.website || null,
    username: o.username || null,
  };
}

/**
 * @param {object}  nextData        parsed __NEXT_DATA__
 * @param {string}  url             the event page URL
 * @param {string}  metaDescription page <meta name="description"> content
 * @param {object[]} guestUsers     raw Luma user objects from the paginated guest-list API
 * @returns {{event, guests, coverage}|null}
 */
export function extractFromLuma({ nextData, url, metaDescription = '', guestUsers = [] }) {
  const data = getInitialData(nextData) || {};
  let ev = data.event || (looksLikeEvent(data) ? data : null);
  if (!ev) ev = deepFind(nextData, looksLikeEvent)[0] || null; // heuristic fallback
  if (!ev) return null;

  const g = ev.geo_address_info || {};
  const event = {
    id: ev.api_id || ev.url || slug(ev.name),
    url,
    name: ev.name,
    description: metaDescription || ev.description || '',
    startAt: ev.start_at || ev.start_at_utc || null,
    location:
      g.full_address ||
      [g.address, g.city, g.region].filter(Boolean).join(', ') ||
      ev.location || null,
    topics: (data.categories || ev.categories || [])
      .map((c) => c.name || String(c.api_id || '').replace(/^cat-/, ''))
      .filter(Boolean),
    organizers: (data.hosts || [])
      .map((h) => ({
        id: h.api_id || slug(fullName(h) || ''),
        name: fullName(h),
        url: h.username ? `https://lu.ma/user/${h.username}` : null,
      }))
      .filter((o) => o.name),
  };

  // Guests: full list from the API (guestUsers) unioned with public featured_guests, deduped by id.
  const gmap = new Map();
  for (const fg of data.featured_guests || []) {
    const p = normPerson(fg);
    if (p.name) gmap.set(p.id, p);
  }
  for (const gu of guestUsers) {
    const p = normPerson(gu);
    if (p.name) gmap.set(p.id, p);
  }
  const guests = [...gmap.values()];

  return {
    event,
    guests,
    coverage: {
      showGuestList: !!ev.show_guest_list,
      guestCount: data.guest_count ?? 0,
      fetchedFullList: guestUsers.length > 0,
      attendeesVisible: guests.length > 0,
    },
  };
}
