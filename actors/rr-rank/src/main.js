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

const TEMPLATE_ID = 'warmpath-rank';
const llmCustom = { model: 'anthropic/claude-sonnet-4.6', base_url: `https://api.butterbase.ai/v1/${appId}`, apikey: bbKey, modelTotalTokens: 32768 };
// Inline fallback (used only if the deployed Cloud template can't be fetched).
const INLINE_PIPELINE = {
  source: 'chat_1',
  components: [
    { id: 'chat_1', provider: 'chat', config: { hideForm: true, mode: 'Source', type: 'chat' } },
    { id: 'llm_1', provider: 'llm_openai_api', config: { profile: 'custom', custom: llmCustom }, input: [{ lane: 'questions', from: 'chat_1' }] },
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
  // Load the pipeline DEPLOYED on RocketRide Cloud (saved template), then point its LLM node at the
  // caller's Butterbase gateway. Falls back to the inline definition if the template can't be fetched.
  let pipeline, source;
  try {
    pipeline = await client.getTemplate({ templateId: TEMPLATE_ID });
    if (!pipeline?.components?.length) throw new Error('empty template');
    const llm = pipeline.components.find((c) => c.provider === 'llm_openai_api');
    if (llm) llm.config = { ...llm.config, profile: 'custom', custom: llmCustom };
    source = 'rocketride-cloud-template';
  } catch (e) {
    console.log('getTemplate failed, using inline pipeline:', e?.message || String(e));
    pipeline = INLINE_PIPELINE;
    source = 'inline-fallback';
  }
  const used = await client.use({ pipeline });
  const ans = await client.chat({ token: used.token || used, question: q });
  await Actor.pushData({ answersRaw: ans.answers?.[0] ?? '', answers: ans.answers ?? [], source });
} finally {
  await client.disconnect().catch(() => {});
}
await Actor.exit();
