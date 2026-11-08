import { createPublicKey, verify } from 'node:crypto';
import { createRepository } from './data.js';
import { autocomplete, commandQuery, errorMessage, ownerId, parseButton, renderQuery } from './messages.js';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function rawBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 65_536) throw new Error('large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function validSignature({ publicKey, signature, timestamp, body, now = Date.now() }) {
  if (!/^[0-9a-f]{64}$/i.test(publicKey || '') || !/^[0-9a-f]{128}$/i.test(signature || '') || !/^\d{10,13}$/.test(timestamp || '')) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(`302a300506032b6570032100${publicKey}`, 'hex'), format: 'der', type: 'spki' });
    return verify(null, Buffer.concat([Buffer.from(timestamp), body]), key, Buffer.from(signature, 'hex'));
  } catch { return false; }
}

async function patchResponse(interaction, message, fetchImpl) {
  const url = `https://discord.com/api/v10/webhooks/${encodeURIComponent(interaction.application_id)}/${encodeURIComponent(interaction.token)}/messages/@original`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchImpl(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message), signal: AbortSignal.timeout(8000) });
    if (response.ok) return;
    if (response.status === 429 && attempt === 0) {
      const data = await response.json();
      if (typeof data.retry_after === 'number' && data.retry_after >= 0 && data.retry_after <= 3) {
        await new Promise((resolve) => setTimeout(resolve, data.retry_after * 1000));
        continue;
      }
    }
    throw new Error('No se pudo responder a Discord');
  }
}

export function createHandler({ env = process.env, schedule, repository = createRepository({ env }), fetchImpl = fetch, log = console.error } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Usa POST' }); }
    if (!/^[0-9a-f]{64}$/i.test(env.DISCORD_PUBLIC_KEY || '')) return json(res, 503, { error: 'Falta configurar Discord' });
    let body;
    try { body = await rawBody(req); }
    catch { return json(res, 413, { error: 'Solicitud demasiado grande' }); }
    if (!validSignature({ publicKey: env.DISCORD_PUBLIC_KEY, signature: req.headers['x-signature-ed25519'], timestamp: req.headers['x-signature-timestamp'], body })) return json(res, 401, { error: 'Firma no válida' });
    let interaction;
    try { interaction = JSON.parse(body.toString('utf8')); }
    catch { return json(res, 400, { error: 'JSON no válido' }); }
    if (interaction.type === 1) return json(res, 200, { type: 1 });
    if (env.DISCORD_APPLICATION_ID && interaction.application_id !== env.DISCORD_APPLICATION_ID) return json(res, 401, { error: 'Aplicación no válida' });
    const reply = (content) => json(res, 200, { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });
    if (interaction.type === 4) {
      if (!['mapa', 'gremio'].includes(interaction.data?.name)) return json(res, 200, { type: 8, data: { choices: [] } });
      let timer;
      try {
        const focused = interaction.data.options?.find((option) => option.focused);
        const query = typeof focused?.value === 'string' ? focused.value.slice(0, 100) : '';
        const choices = await Promise.race([
          repository().then((maps) => autocomplete(maps, interaction.data.name, query)),
          new Promise((resolve) => { timer = setTimeout(() => resolve([]), 1800); }),
        ]);
        return json(res, 200, { type: 8, data: { choices } });
      } catch { return json(res, 200, { type: 8, data: { choices: [] } }); }
      finally { clearTimeout(timer); }
    }
    let mode, query, page = 0;
    const owner = ownerId(interaction);
    if (!/^\d{1,25}$/.test(owner || '')) return reply('No pude identificar la consulta. Vuelve a usar /mapa o /gremio.');
    if (interaction.type === 2) {
      mode = interaction.data?.name;
      query = commandQuery(interaction);
      if (!['mapa', 'gremio'].includes(mode) || !query) return reply('Usa /mapa nombre o /gremio nombre.');
    } else if (interaction.type === 3) {
      const cursor = parseButton(interaction.data?.custom_id);
      if (!cursor) return reply('Este botón no corresponde a una consulta.');
      if (cursor.owner !== owner) return reply('Estos botones son para quien hizo la consulta. Usa /mapa o /gremio para iniciar la tuya.');
      mode = cursor.mode;
      page = cursor.page;
      query = interaction.message?.embeds?.[0]?.author?.name;
      if (typeof query !== 'string' || !query.trim() || query.length > 100) return reply('La consulta ya no es válida. Usa /mapa o /gremio otra vez.');
    } else { return reply('Interacción no compatible.'); }
    if (!/^\d{1,25}$/.test(interaction.application_id || '') || typeof interaction.token !== 'string' || !interaction.token) return json(res, 400, { error: 'Interacción incompleta' });
    const task = (async () => {
      let message;
      try { message = renderQuery({ maps: await repository(), mode, query, page, owner, website: env.WEBSITE_URL }); }
      catch { message = errorMessage(); }
      try { await patchResponse(interaction, message, fetchImpl); }
      catch { log('Discord: no se pudo entregar la respuesta', String(interaction.id || '').slice(0, 25)); }
    })();
    schedule(task);
    return json(res, 200, { type: interaction.type === 3 ? 6 : 5 });
  };
}
