import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConnection, validateSettings, publicSettings } from '../src/config.js';

test('connection accepts only HTTP origins without embedded credentials or query strings', () => {
  const c = validateConnection({ ZENTAO_BASE_URL: 'http://intranet:81/zentao/', ZENTAO_ACCOUNT: 'me', ZENTAO_PASSWORD: 'secret' });
  assert.equal(c.baseUrl, 'http://intranet:81/zentao');
  assert.throws(() => validateConnection({ ZENTAO_BASE_URL: 'file:///private', ZENTAO_ACCOUNT: 'me', ZENTAO_PASSWORD: 's' }), /地址/);
  assert.throws(() => validateConnection({ ZENTAO_BASE_URL: 'http://name:secret@host/', ZENTAO_ACCOUNT: 'me', ZENTAO_PASSWORD: 's' }), /地址/);
});

test('settings accept the notification window and reject arbitrary credential or path writes', () => {
  assert.equal(validateSettings({ pollSeconds: 30 }).pollSeconds, 30);
  assert.equal(validateSettings({ pollSeconds: 60 }).pollSeconds, 60);
  for (const pollSeconds of [0, 29, 61, 45.5, '45']) assert.throws(() => validateSettings({ pollSeconds }), /30.*60/);
  assert.throws(() => validateSettings({ connectionFile: 'C:/private' }), /不允许/);
  assert.throws(() => validateSettings({ password: 's' }), /不允许/);
  assert.throws(() => validateSettings({ petEnabled: 'true' }), /布尔/);
});

test('public configuration contains no secret even when private config has extra keys', () => {
  const result = publicSettings({ pollSeconds: 45, petEnabled: true, notificationsEnabled: true, petId: '', password: 'never-visible', token: 'never-visible' }, 'C:/connection.json', true);
  assert.equal(result.hasCredentials, true);
  assert.ok(!JSON.stringify(result).includes('never-visible'));
  assert.deepEqual(Object.keys(result).sort(), ['connectionFile', 'hasCredentials', 'notificationsEnabled', 'petEnabled', 'petId', 'petAlerts', 'petDurationSeconds', 'pollSeconds'].sort());
});
