import { commands } from './commands.js';
import { application } from './application.js';
import { registerCommands } from './registration.js';

if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify(commands, null, 2));
} else {
  try {
    const result = await registerCommands({
      applicationId: process.env.DISCORD_APPLICATION_ID || application.id,
      guildId: process.env.DISCORD_GUILD_ID,
      token: process.env.DISCORD_REGISTRATION_TOKEN || process.env.DISCORD_BOT_TOKEN,
    });
    console.log('Comandos /mapa y /gremio registrados.');
    console.log('Invitación:', result.invite);
  } catch {
    console.error('No se pudieron registrar los comandos. Revisa el acceso y DISCORD_REGISTRATION_TOKEN o DISCORD_BOT_TOKEN en los ajustes seguros. No pegues el token en el chat.');
    process.exitCode = 1;
  }
}
