import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Readable } from 'node:stream';
import { createHandler, validSignature } from './handler.js';
import { createRepository } from './data.js';
import { autocomplete, parseButton, renderQuery } from './messages.js';
import { commands } from './commands.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const hexKey = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
const maps = [
  { name: 'Avalanche Incline', guilds: ['ifures', 'pivas', 'take care', 'darkmight'] },
  { name: 'Avalanche Ravine', guilds: ['IFURES', 'SANTA ISABEL'] },
  { name: 'Blackthorn Quarry', guilds: ['NIGHT WATCH'] },
];
const slash = { type: 2, id: '111', application_id: '222', token: 'test-only-token', member: { user: { id: '333' } }, data: { name: 'mapa', options: [{ name: 'nombre', value: 'Avalanche Incline' }] } };

function request(payload, { timestamp = String(Math.floor(Date.now() / 1000)), signature, method = 'POST' } = {}) {
  const body = typeof payload === 'string' ? Buffer.from(payload) : Buffer.from(JSON.stringify(payload));
  const req = Readable.from([body]);
  req.method = method;
  req.headers = { 'x-signature-timestamp': timestamp, 'x-signature-ed25519': signature ?? sign(null, Buffer.concat([Buffer.from(timestamp), body]), privateKey).toString('hex') };
  return req;
}
function response() {
  return { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = JSON.parse(body); } };
}
function setup(overrides = {}) {
  const tasks = [], deliveries = [], logs = [];
  const handler = createHandler({ env: { DISCORD_PUBLIC_KEY: hexKey }, repository: async () => maps,
    schedule: (task) => tasks.push(task), log: (...args) => logs.push(args),
    fetchImpl: async (url, options) => { deliveries.push({ url, options, body: JSON.parse(options.body) }); return new Response('', { status: 200 }); }, ...overrides });
  return { handler, tasks, deliveries, logs };
}

test('solo registra /mapa y /gremio con autocompletado', () => {
  assert.deepEqual(commands.map((item) => item.name), ['mapa', 'gremio']);
  assert.ok(commands.every((item) => item.options[0].autocomplete && item.options[0].max_length === 100));
});

test('mapa respeta exactamente el orden guardado', () => {
  const message = renderQuery({ maps, mode: 'mapa', query: 'avalanche incline', owner: '333' });
  assert.equal(message.embeds[0].fields[0].value, '1. ifures\n2. pivas\n3. take care\n4. darkmight');
  assert.deepEqual(message.allowed_mentions, { parse: [] });
  assert.match(message.embeds[0].footer.text, /4 gremios/);
});

test('gremio busca coincidencia exacta sin distinguir mayúsculas ni duplicar mapas', () => {
  const message = renderQuery({ maps: [...maps, { name: 'Otra zona', guilds: ['ifures junior'] }], mode: 'gremio', query: 'ifures', owner: '333' });
  assert.match(message.embeds[0].fields[0].value, /Avalanche Incline\n2. Avalanche Ravine/);
  assert.match(message.embeds[0].footer.text, /2 mapas/);
  assert.doesNotMatch(message.embeds[0].fields[0].value, /Otra zona/);
});

test('paginación sin perder nombres ni sobrepasar los límites de Discord', () => {
  const names = Array.from({ length: 36 }, (_, i) => `${String(i).padStart(2, '0')}_${'*'.repeat(90)}`);
  const message = renderQuery({ maps: [{ name: 'Grande', guilds: names }], mode: 'mapa', query: 'Grande', owner: '333' });
  assert.ok(message.embeds[0].fields.every((field) => field.value.length <= 1024));
  assert.equal(message.embeds[0].fields.map((field) => field.value).join('\n').split('\n').length, 15);
  assert.equal(message.components[0].components[0].disabled, true);
  assert.equal(message.components[0].components[1].disabled, false);
  assert.equal(message.components[0].components[1].custom_id, 'guildtrace:mapa:1:333');
  const last = renderQuery({ maps: [{ name: 'Grande', guilds: names }], mode: 'mapa', query: 'Grande', owner: '333', page: 99999 });
  assert.match(last.embeds[0].footer.text, /Página 3 de 3/);
  assert.equal(last.components[0].components[1].disabled, true);
  assert.ok(last.components.flatMap((row) => row.components).every((item) => !item.custom_id || item.custom_id.length <= 100));
});

test('consulta inexistente ofrece sugerencias sin inventar datos', () => {
  const result = renderQuery({ maps, mode: 'mapa', query: 'Avalanche', owner: '333' });
  assert.match(result.content, /Avalanche Incline/);
  assert.deepEqual(result.embeds, []);
});

test('autocomplete limita a 25, elimina duplicados y trata % y _ literalmente', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ name: `Mapa ${i}`, guilds: ['IFURES', 'ifures', 'A_B%'] }));
  assert.equal(autocomplete(many, 'mapa', '').length, 25);
  assert.deepEqual(autocomplete(many, 'gremio', 'ifures'), [{ name: 'IFURES', value: 'IFURES' }]);
  assert.deepEqual(autocomplete(many, 'gremio', '_B%'), [{ name: 'A_B%', value: 'A_B%' }]);
});

test('rechaza cursores alterados y evita enlaces no HTTPS', () => {
  assert.equal(parseButton('guildtrace:gremio:-1:333'), null);
  assert.equal(parseButton('other:mapa:1:333'), null);
  assert.throws(() => renderQuery({ maps, mode: 'mapa', query: 'Avalanche Incline', owner: '333', website: 'javascript:alert(1)' }));
});

test('PING firmado responde sin tocar Supabase', async () => {
  const state = setup({ repository: () => { throw new Error('No debe consultar'); } });
  const res = response();
  await state.handler(request({ type: 1 }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { type: 1 });
  assert.equal(state.tasks.length, 0);
});

test('firma incorrecta, antigua, cuerpo manipulado y JSON inválido son rechazados', async () => {
  const state = setup();
  for (const [req, expected] of [
    [request({ type: 1 }, { signature: '0'.repeat(128) }), 401],
    [request({ type: 1 }, { timestamp: String(Math.floor(Date.now() / 1000) - 600) }), 401],
    [request('{invalid json'), 400],
  ]) { const res = response(); await state.handler(req, res); assert.equal(res.statusCode, expected); }
  const raw = Buffer.from('{"type":1}');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.concat([Buffer.from(timestamp), raw]), privateKey).toString('hex');
  assert.equal(validSignature({ publicKey: hexKey, timestamp, signature, body: Buffer.from('{ "type":1}') }), false);
});

test('método inválido, clave ausente y cuerpos enormes no se procesan', async () => {
  let res = response(); await setup().handler(request({}, { method: 'GET' }), res); assert.equal(res.statusCode, 405);
  res = response(); await setup({ env: {} }).handler(request({ type: 1 }), res); assert.equal(res.statusCode, 503);
  res = response(); await setup().handler(request('x'.repeat(66000)), res); assert.equal(res.statusCode, 413);
});

test('comando se difiere antes de que Supabase termine y luego edita la respuesta original', async () => {
  let finish;
  const state = setup({ repository: () => new Promise((resolve) => { finish = resolve; }) });
  const res = response();
  await state.handler(request(slash), res);
  assert.deepEqual(res.body, { type: 5 });
  assert.equal(state.deliveries.length, 0);
  finish(maps);
  await Promise.all(state.tasks);
  assert.equal(state.deliveries[0].options.method, 'PATCH');
  assert.match(state.deliveries[0].url, /\/webhooks\/222\/test-only-token\/messages\/@original$/);
  assert.equal(state.deliveries[0].body.embeds[0].title, 'Avalanche Incline');
});

test('otro usuario no puede cambiar la página del solicitante', async () => {
  const state = setup(); const res = response();
  await state.handler(request({ ...slash, type: 3, data: { custom_id: 'guildtrace:mapa:1:999' } }), res);
  assert.equal(res.body.type, 4);
  assert.equal(res.body.data.flags, 64);
  assert.equal(state.tasks.length, 0);
});

test('botones funcionan sin memoria del servidor y conservan la consulta original', async () => {
  const state = setup(); const res = response();
  await state.handler(request({ ...slash, type: 3, data: { custom_id: 'guildtrace:gremio:1:333' }, message: { embeds: [{ author: { name: 'ifures' } }] } }), res);
  assert.deepEqual(res.body, { type: 6 });
  await Promise.all(state.tasks);
  assert.match(state.deliveries[0].body.embeds[0].footer.text, /2 mapas/);
});

test('autocomplete es una respuesta Discord válida', async () => {
  const state = setup(); const res = response();
  await state.handler(request({ ...slash, type: 4, data: { name: 'gremio', options: [{ name: 'nombre', value: 'ifu', focused: true }] } }), res);
  assert.equal(res.body.type, 8);
  assert.deepEqual(res.body.data.choices, [{ name: 'ifures', value: 'ifures' }]);
});

test('fallo de Supabase entrega un aviso, sin filtrar secretos ni dejar el bot pensando', async () => {
  const state = setup({ repository: async () => { throw new Error('secret-demo'); } }); const res = response();
  await state.handler(request(slash), res); await Promise.all(state.tasks);
  assert.match(state.deliveries[0].body.content, /No pude consultar/);
  assert.doesNotMatch(JSON.stringify(state.deliveries[0].body), /secret-demo/);
});

test('paginar Supabase respeta límites del servidor menores de 500 y comparte la caché', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i, map: 'Mapa', guild_name: `Gremio ${i}` }));
  const calls = []; let clock = 100;
  const repository = createRepository({ env: { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'test-public-key' }, now: () => clock,
    fetchImpl: async (url, options) => {
      calls.push({ url: url.href, method: options.method });
      const offset = Number(url.searchParams.get('offset'));
      return new Response(JSON.stringify(rows.slice(offset, offset + 2)), { headers: { 'content-range': `${offset}-${Math.min(offset + 1, 4)}/5` } });
    } });
  const [first, second] = await Promise.all([repository(), repository()]);
  assert.deepEqual(first[0].guilds, rows.map((row) => row.guild_name));
  assert.equal(first, second);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => !call.method || call.method === 'GET'));
  await repository(); assert.equal(calls.length, 3);
  clock += 10001; await repository(); assert.equal(calls.length, 6);
});

test('datos incompletos no se aceptan ni se publican como una lista completa', async () => {
  const repository = createRepository({ env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public-key' }, fetchImpl: async () => new Response('[]') });
  await assert.rejects(repository(), /carga completa/);
});

test('endpoint Web de Vercel verifica el cuerpo exacto, incluidos espacios y saltos', async () => {
  const originalKey = process.env.DISCORD_PUBLIC_KEY;
  process.env.DISCORD_PUBLIC_KEY = hexKey;
  try {
    const { POST } = await import('../api/discord.js');
    const body = '{\n  "type": 1\n}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
    const res = await POST(new Request('https://example.com/api/discord', { method: 'POST', body, headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp } }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { type: 1 });
  } finally {
    if (originalKey === undefined) delete process.env.DISCORD_PUBLIC_KEY;
    else process.env.DISCORD_PUBLIC_KEY = originalKey;
  }
});
