import { Actor } from 'apify';
import { RocketRideClient, Question } from 'rocketride';

/**
 * WarmPath ranking on RocketRide Cloud.
 * Runs a pipeline (chat -> llm_openai_api pointed at Butterbase's OpenAI-compatible gateway ->
 * response_answers) on RocketRide Cloud, so the app's ranking step is a managed Cloud pipeline.
 * Input: { candidates:[{name,headline}], prefs, profile, bbKey, appId, rrKey }
 * Output (dataset item): { answersRaw, answers }
 */
await Actor.init();
const input = (await Actor.getInput()) || {};
const { candidates = [], prefs = '', profile = '', bbKey, appId, rrKey } = input;

const pipeline = {
  source: 'chat_1',
  components: [
    { id: 'chat_1', provider: 'chat', config: { hideForm: true, mode: 'Source', type: 'chat' } },
    { id: 'llm_1', provider: 'llm_openai_api', config: { profile: 'custom', custom: {
      model: 'anthropic/claude-sonnet-4.6',
      base_url: `https://api.butterbase.ai/v1/${appId}`,
      apikey: bbKey, modelTotalTokens: 32768,
    } }, input: [{ lane: 'questions', from: 'chat_1' }] },
    { id: 'out_1', provider: 'response_answers', config: {}, input: [{ lane: 'answers', from: 'llm_1' }] },
  ],
};

const list = candidates.map((c, i) => `${i}) ${c.name} — ${c.headline}`).join('\n');
const q = new Question({});
q.addInstruction('Role',
  'You are a sharp networking assistant. From the attendees, pick the best people for the user to meet ' +
  'given their goal and background. Prefer concrete relevance. Return ONLY a JSON array of up to 8 objects: ' +
  '{"idx": <number from the list>, "why": "<=15 words", "opener": "one specific warm opening line"}.');
q.addQuestion(
  `MY GOAL:\n${prefs || '(no specific preferences — pick the most relevant builders/founders)'}\n\n` +
  (profile ? `MY BACKGROUND:\n${profile}\n\n` : '') + `ATTENDEES:\n${list}`);

const client = new RocketRideClient({ auth: rrKey, uri: 'https://api.rocketride.ai' });
try {
  await client.connect();
  const used = await client.use({ pipeline });
  const ans = await client.chat({ token: used.token || used, question: q });
  await Actor.pushData({ answersRaw: ans.answers?.[0] ?? '', answers: ans.answers ?? [] });
} finally {
  await client.disconnect().catch(() => {});
}
await Actor.exit();
