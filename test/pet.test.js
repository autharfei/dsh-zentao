import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PetClient } from '../src/pet.js';

test('pet client discovers a desktop pet and checks the business acceptance result', async () => {
  const client = new PetClient({ origin: 'http://127.0.0.1:1234', fetchImpl: async (input, options) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/config')) return Response.json({ main: { pets: [{ id: 'web', name: '网页', display: 'web' }, { id: 'fish', name: '鱼', display: 'both' }] } });
    assert.equal(url.searchParams.get('pet'), 'fish'); assert.equal(url.searchParams.get('surface'), 'desktop');
    assert.equal(JSON.parse(options.body).anim, false); assert.equal(JSON.parse(options.body).text, '新任务');
    return Response.json({ ok: true });
  } });
  assert.equal((await client.list()).pets.length, 2); assert.equal((await client.send('新任务')).accepted, true);
});

test('HTTP 200 with lock-required is failure, not delivery', async () => {
  const client = new PetClient({ origin: 'http://127.0.0.1:1234', petId: () => 'fish', fetchImpl: async input => new URL(input).pathname.endsWith('/config') ? Response.json({ main: { pets: [{ id: 'fish', display: 'desktop' }] } }) : Response.json({ ok: false, reason: 'lock-required' }) });
  await assert.rejects(client.send('新任务'), /占用|lock-required/);
});

test('missing desktop pet is actionable and never falls back to an invisible web pet', async () => {
  const client = new PetClient({ origin: 'http://127.0.0.1:1234', fetchImpl: async () => Response.json({ main: { pets: [{ id: 'web', display: 'web' }] } }) });
  await assert.rejects(client.send('新任务'), /桌面/);
});
