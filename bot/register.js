import { commands } from './commands.js';
import { application } from './application.js';

const app = process.env.DISCORD_APPLICATION_ID || application.id;
const guild = process.env.DISCORD_GUILD_ID;
const token = process.env.DISCORD_BOT_TOKEN;
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify(commands, null, 2));
} else if (!/^\d{1,25}$/.test(app || '') || !token || (guild && !/^\d{1,25}$/.test(guild))) {
  console.error('Configura DISCORD_APPLICATION_ID y DISCORD_BOT_TOKEN de forma segura. DISCORD_GUILD_ID es opcional. No pegues el token en el chat.');
  process.exitCode = 1;
} else {
  try {
    const path = guild ? `applications/${app}/guilds/${guild}/commands` : `applications/${app}/commands`;
    const response = await fetch(`https://discord.com/api/v10/${path}`, {
      method: 'PUT', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Registro rechazado');
    console.log('Comandos /mapa y /gremio registrados.');
    const invite = new URL('https://discord.com/oauth2/authorize');
    invite.search = new URLSearchParams({ client_id: app, scope: 'bot applications.commands', permissions: '19456' });
    console.log('Invitación:', invite.href);
  } catch {
    console.error('No se pudieron registrar los comandos. Revisa el acceso de red, el Application ID y el token en los ajustes seguros.');
    process.exitCode = 1;
  }
}
