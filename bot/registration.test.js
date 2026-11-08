import test from 'node:test';
import assert from 'node:assert/strict';
import { registerCommands, RegistrationError } from './registration.js';
import { application } from './application.js';

const token = 'test-only-placeholder-no-real-access';
test('verifica identidad antes de registrar y devuelve solo datos públicos', async () => {
  const calls = [];
  const result = await registerCommands({ token, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(calls.length === 1 ? { id: application.id } : [{ name: 'mapa' }, { name: 'gremio' }]));
  } });
  assert.match(calls[0].url, /oauth2\/applications\/@me$/);
  assert.equal(calls[0].options.headers.Authorization, `Bot ${token}`);
  assert.equal(calls[1].options.method, 'PUT');
  assert.match(calls[1].url, new RegExp(`/applications/${application.id}/commands$`));
  assert.deepEqual(result.commands, ['mapa', 'gremio']);
  assert.equal(new URL(result.invite).searchParams.get('client_id'), application.id);
  assert.ok(!JSON.stringify(result).includes(token));
});

test('token de otra aplicación no permite modificar comandos', async () => {
  let calls = 0;
  await assert.rejects(registerCommands({ token, fetchImpl: async () => { calls++;return new Response(JSON.stringify({ id: 'otra-aplicacion' })); } }), (error) => error.status === 403);
  assert.equal(calls, 1);
});

test('token malformado se rechaza antes de contactar con Discord', async () => {
  await assert.rejects(registerCommands({ token: 'bad\r\nheader', fetchImpl: () => { throw new Error('No debe llamarse'); } }), (error) => error.status === 400);
});

test('errores de Discord y rate limit no filtran la respuesta ni el token', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(registerCommands({ token, fetchImpl: async () => new Response(`secret-${token}`, { status }) }), (error) => error instanceof RegistrationError && !error.message.includes(token));
  }
});

test('no acepta un registro parcial como éxito', async () => {
  let calls = 0;
  await assert.rejects(registerCommands({ token, fetchImpl: async () => new Response(JSON.stringify(++calls === 1 ? { id: application.id } : [{ name: 'mapa' }])) }), (error) => error.status === 502);
});
