import { application } from './application.js';
import { commands } from './commands.js';

export class RegistrationError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function registerCommands({ token, applicationId = application.id, guildId, fetchImpl = fetch }) {
  if (!/^\d{1,25}$/.test(applicationId) || (guildId && !/^\d{1,25}$/.test(guildId))) throw new RegistrationError(400, 'La configuración de la aplicación no es válida.');
  if (typeof token !== 'string' || !/^[A-Za-z0-9._-]{20,300}$/.test(token)) throw new RegistrationError(400, 'Pega el token privado de la sección Bot, no la Public Key.');
  const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };
  const identity = await fetchImpl('https://discord.com/api/v10/oauth2/applications/@me', { headers, signal: AbortSignal.timeout(8000) });
  if (identity.status === 401 || identity.status === 403) throw new RegistrationError(401, 'Discord rechazó el token. Cópialo de nuevo desde la sección Bot.');
  if (identity.status === 429) throw new RegistrationError(429, 'Discord pide esperar. Inténtalo de nuevo en unos minutos.');
  if (!identity.ok) throw new RegistrationError(502, 'No se pudo verificar la aplicación en Discord.');
  const account = await identity.json();
  if (account.id !== applicationId) throw new RegistrationError(403, 'Este token pertenece a otra aplicación. Usa el de GuildTrace.');
  const path = guildId ? `applications/${applicationId}/guilds/${guildId}/commands` : `applications/${applicationId}/commands`;
  const result = await fetchImpl(`https://discord.com/api/v10/${path}`, {
    method: 'PUT', headers, body: JSON.stringify(commands), signal: AbortSignal.timeout(8000),
  });
  if (result.status === 429) throw new RegistrationError(429, 'Discord pide esperar. Inténtalo de nuevo en unos minutos.');
  if (!result.ok) throw new RegistrationError(502, 'Discord no pudo registrar los comandos. Revisa el token y vuelve a intentarlo.');
  const registered = await result.json();
  if (!Array.isArray(registered) || !commands.every((command) => registered.some((item) => item.name === command.name))) throw new RegistrationError(502, 'Discord no confirmó todos los comandos. Vuelve a intentarlo.');
  const invite = new URL('https://discord.com/oauth2/authorize');
  invite.search = new URLSearchParams({ client_id: applicationId, scope: 'bot applications.commands', permissions: '19456' });
  return { commands: commands.map((command) => command.name), invite: invite.href };
}
