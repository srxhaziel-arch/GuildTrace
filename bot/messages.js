const normalize = (value) => value.trim().toLocaleLowerCase('es');
const escape = (value) => value.replace(/[\r\n]/g, ' ').replace(/[\\`*_~|>[\]]/g, '\\$&').slice(0, 180);
const baseMessage = { allowed_mentions: { parse: [] } };
export const errorMessage = () => ({ ...baseMessage, content: 'No pude consultar los datos. Inténtalo de nuevo en unos momentos.', embeds: [], components: [] });
export const ownerId = (interaction) => interaction.member?.user?.id || interaction.user?.id;

export function commandQuery(interaction) {
  const value = interaction.data?.options?.find((option) => option.name === 'nombre')?.value;
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 100 ? value.trim() : null;
}

export function parseButton(id) {
  if (typeof id !== 'string') return null;
  const match = /^guildtrace:(mapa|gremio):(\d{1,5}):(\d{1,25})$/.exec(id);
  return match ? { mode: match[1], page: Number(match[2]), owner: match[3] } : null;
}

export function autocomplete(maps, mode, query) {
  const names = mode === 'mapa' ? maps.map((map) => map.name) : maps.flatMap((map) => map.guilds);
  const unique = new Map();
  for (const name of names) {
    if (name.length <= 100 && normalize(name).includes(normalize(query)) && !unique.has(normalize(name))) unique.set(normalize(name), name);
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b, 'es')).slice(0, 25).map((name) => ({ name, value: name }));
}

export function renderQuery({ maps, mode, query, page = 0, owner, website = 'https://hozonanegra.vercel.app/' }) {
  const match = normalize(query);
  const map = mode === 'mapa' ? maps.find((item) => normalize(item.name) === match) : null;
  const matches = mode === 'gremio' ? maps.filter((item) => item.guilds.some((name) => normalize(name) === match)) : [];
  const items = mode === 'mapa' ? map?.guilds : matches.map((item) => item.name);
  if (!items || (mode === 'gremio' && !matches.length)) {
    const suggestions = autocomplete(maps, mode, query).slice(0, 8);
    return { ...baseMessage, content: `No encontré ese ${mode}.` + (suggestions.length ? `\nPrueba con:\n${suggestions.map((item) => `• ${escape(item.name)}`).join('\n')}` : '\nComprueba el nombre y vuelve a consultar.'), embeds: [], components: [] };
  }
  const size = mode === 'mapa' ? 15 : 10;
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const canonical = mode === 'mapa' ? map.name : matches.flatMap((item) => item.guilds).find((name) => normalize(name) === match);
  const description = items.slice(current * size, (current + 1) * size).map((name, index) => `${current * size + index + 1}. ${escape(name)}`).join('\n') || 'Todavía no hay gremios registrados en este mapa.';
  const fields = [];
  for (const line of description.split('\n')) {
    const last = fields.at(-1);
    if (last && last.value.length + line.length + 1 <= 1024) last.value += `\n${line}`;
    else fields.push({ name: mode === 'mapa' ? 'GREMIOS' : 'MAPAS', value: line });
  }
  const components = [];
  if (pages > 1) components.push({ type: 1, components: [
    { type: 2, style: 2, label: '← Anterior', custom_id: `guildtrace:${mode}:${Math.max(0, current - 1)}:${owner}`, disabled: current === 0 },
    { type: 2, style: 2, label: 'Siguiente →', custom_id: `guildtrace:${mode}:${Math.min(pages - 1, current + 1)}:${owner}`, disabled: current === pages - 1 },
  ] });
  const url = new URL(website);
  if (url.protocol !== 'https:') throw new Error('La web debe usar HTTPS');
  components.push({ type: 1, components: [{ type: 2, style: 5, label: 'Abrir en la web', url: url.href }] });
  return { ...baseMessage, content: '', embeds: [{
    author: { name: query },
    title: escape(canonical), color: 0xd4ad4c,
    description: mode === 'mapa' ? 'Zona Negra · Gremios registrados' : 'Mapas donde aparece',
    fields,
    footer: { text: `${items.length} ${mode === 'mapa' ? 'gremios' : 'mapas'} · Página ${current + 1} de ${pages} · GuildTrace` },
  }], components };
}
