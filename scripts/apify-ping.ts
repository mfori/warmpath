import { ApifyClient } from 'apify-client';
import 'dotenv/config';

// Smoke test: prove the Apify token works.
const token = process.env.APIFY_TOKEN;
if (!token) throw new Error('Missing APIFY_TOKEN in .env');

const client = new ApifyClient({ token });
const me = await client.user('me').get();
console.log('✅ Apify connected as:', me?.username ?? '(unknown)');

if (process.env.LUMA_ACTOR_ID) {
  const actor = await client.actor(process.env.LUMA_ACTOR_ID).get();
  console.log('   luma actor:', actor?.name ?? 'not found');
}
