/**
 * WarmPath run — STARTS a live Luma scrape (async) and returns immediately.
 * Butterbase edge function (Deno). Poll /scrape-status with the returned ids to get the result.
 *
 * POST JSON: { lumaCookie, eventUrl }
 * Returns: { runId, datasetId, status, me }
 * Env: APIFY_TOKEN, LUMA_ACTOR_ID.
 */

export default async function handler(request, ctx) {
  const env = ctx?.env ?? {};
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    const { lumaCookie, eventUrl } = request.method === 'POST'
      ? await request.json()
      : Object.fromEntries(new URL(request.url).searchParams);
    if (!lumaCookie || !eventUrl) throw new Error('lumaCookie and eventUrl are required');

    const me = (lumaCookie.match(/luma\.auth-session-key=(usr-[A-Za-z0-9]+)/) || [])[1] || null;
    const actor = env.LUMA_ACTOR_ID || '24IgHc5uP6zS1i7LW';

    // Start the actor async (do NOT wait) — avoids any synchronous HTTP timeout.
    const res = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/runs?token=${env.APIFY_TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventUrls: [eventUrl], lumaCookie, scrapeGuests: true, maxEvents: 1 }),
    });
    if (!res.ok) throw new Error(`apify start ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { data } = await res.json();

    return new Response(JSON.stringify({ runId: data.id, datasetId: data.defaultDatasetId, status: data.status, me }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
}
