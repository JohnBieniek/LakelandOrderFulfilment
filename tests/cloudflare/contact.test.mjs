import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitContact } from '../../cloudflare/contact.ts';

const url = 'https://studio.example/api/contact';
const valid = { name: 'Test visitor', email: 'visitor@example.com', message: 'A question about the artwork.' };
function request(value = valid, headers = {}, method = 'POST') {
  return new Request(url, { method, headers: { Origin: 'https://studio.example', 'Content-Type': 'application/json', ...headers },
    ...(method === 'POST' ? { body: JSON.stringify(value) } : {}) });
}
function environment() {
  const sent = [];
  return { sent, CONTACT_EMAIL: { async send(message) { sent.push(message); return { messageId: 'test-id' }; } },
    CONTACT_RATE_LIMIT: { async limit() { return { success: true }; } },
    CONTACT_GLOBAL_LIMIT: { async limit() { return { success: true }; } } };
}

test('sends once to the fixed mailbox, with safe sender and visitor Reply-To', async () => {
  const env = environment();
  const response = await submitContact(request({ ...valid, to: 'attacker@example.com', from: 'spoof@example.com', subject: 'override' }), env);
  assert.equal(response.status, 200);
  assert.equal(env.sent.length, 1);
  assert.equal(env.sent[0].to, 'contact-form@lakelandfinearts.com');
  assert.equal(env.sent[0].from.email, 'website@lakelandfinearts.com');
  assert.equal(env.sent[0].replyTo.email, valid.email);
  assert.notEqual(env.sent[0].subject, 'override');
  assert.ok(env.sent[0].text.includes(valid.message));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('rejects missing, blank, oversized, wrong-type and header-injection fields', async () => {
  const env = environment();
  const invalid = [null, [], {}, ...['name', 'email', 'message'].flatMap(key =>
    ['', '  ', 123, {}, null].map(value => ({ ...valid, [key]: value }))),
    { ...valid, name: 'a'.repeat(101) }, { ...valid, message: 'a'.repeat(3001) },
    { ...valid, email: 'invalid' }, { ...valid, name: 'Name\r\nBcc: attacker@example.com' },
    { ...valid, email: 'visitor@example.com\r\nBcc: attacker@example.com' }];
  for (const value of invalid) assert.equal((await submitContact(request(value), env)).status, 400);
  assert.equal(env.sent.length, 0);
});

test('escapes HTML while retaining readable text and Unicode', async () => {
  const env = environment();
  const message = '<img src=x onerror=alert(1)>\nArtwork: café & clay';
  assert.equal((await submitContact(request({ ...valid, message }), env)).status, 200);
  assert.ok(env.sent[0].html.includes('&lt;img'));
  assert.ok(!env.sent[0].html.includes('<img'));
  assert.ok(env.sent[0].html.includes('<br>'));
  assert.ok(env.sent[0].text.includes(message));
});

test('rejects cross-origin, wrong-method, malformed and oversized requests without sending', async () => {
  const env = environment();
  assert.equal((await submitContact(request(valid, { Origin: 'https://elsewhere.example' }), env)).status, 403);
  assert.equal((await submitContact(request(valid, {}, 'GET'), env)).status, 405);
  assert.equal((await submitContact(request(valid, { 'Content-Type': 'text/plain' }), env)).status, 415);
  assert.equal((await submitContact(request(valid, { 'Content-Length': '20000' }), env)).status, 413);
  assert.equal((await submitContact(request({ message: 'x'.repeat(17000) }), env)).status, 413);
  const malformed = new Request(url, { method: 'POST', headers: { Origin: 'https://studio.example', 'Content-Type': 'application/json' }, body: '{' });
  assert.equal((await submitContact(malformed, env)).status, 400);
  assert.equal(env.sent.length, 0);
});

test('rate limiting stops delivery and advertises a retry delay', async () => {
  for (const key of ['CONTACT_RATE_LIMIT', 'CONTACT_GLOBAL_LIMIT']) {
    const env = environment();
    env[key].limit = async () => ({ success: false });
    const result = await submitContact(request(), env);
    assert.equal(result.status, 429);
    assert.equal(result.headers.get('Retry-After'), '60');
    assert.equal(env.sent.length, 0);
  }
});

test('provider rejection never reports success or leaks its error', async () => {
  const env = environment();
  env.CONTACT_EMAIL.send = async () => { throw Error('private provider diagnostic'); };
  const response = await submitContact(request(), env);
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('private provider diagnostic'));
});
