// Lectura únicamente: nunca usa claves service_role ni escribe en Supabase.
export function createRepository({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  let cached;
  let expires = 0;
  let pending;

  async function read() {
    const base = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
    if (!base || !key) throw new Error('Falta configuración de Supabase');
    const url = new URL('/rest/v1/mapas_hideouts', base);
    if (url.protocol !== 'https:') throw new Error('Supabase requiere HTTPS');
    url.search = new URLSearchParams({ select: 'id,map,guild_name', radar: 'eq.black-zone', order: 'id.asc', limit: '500' });
    const rows = [];
    for (let page = 0; page < 200; page++) {
      url.searchParams.set('offset', String(rows.length));
      const response = await fetchImpl(url, {
        headers: { apikey: key, Prefer: 'count=exact' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('No se pudieron leer los mapas');
      const batch = await response.json();
      if (!Array.isArray(batch)) throw new Error('Respuesta de datos no válida');
      const range = response.headers.get('content-range');
      const total = range && /\/(\d+)$/.exec(range);
      if (!total) throw new Error('No se pudo verificar la carga completa');
      rows.push(...batch);
      if (rows.length >= Number(total[1])) {
        const maps = new Map();
        for (const row of rows) {
          if (typeof row.map !== 'string' || !row.map.trim()) continue;
          if (!maps.has(row.map)) maps.set(row.map, { name: row.map, guilds: [] });
          if (typeof row.guild_name === 'string' && row.guild_name.trim()) maps.get(row.map).guilds.push(row.guild_name);
        }
        return [...maps.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
      }
      if (!batch.length) throw new Error('La carga de mapas quedó incompleta');
    }
    throw new Error('Demasiados registros para completar la consulta');
  }

  return async function snapshot() {
    if (cached && now() < expires) return cached;
    if (!pending) pending = read().then((maps) => {
      cached = maps;
      expires = now() + 10_000;
      return maps;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}
