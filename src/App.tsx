import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  FolderOpen,
  Loader2,
  Moon,
  Pencil,
  Plus,
  Search,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { Analytics } from '@vercel/analytics/react';
import { supabase } from '@/lib/supabase';

type Guild = { name: string };
type MapEntry = {
  id: string;
  map: string;
  guilds: Guild[];
  lastEdited?: string;
};

const RADAR_KEY = 'black-zone';
const RADAR_NAME = 'HO Zona Negra';

function toDbGuilds(guilds: Guild[]) {
  return guilds.filter((g) => g.name.trim()).map((g) => ({
    name: g.name.trim(),
  }));
}

function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [data, setData] = useState<MapEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingMap, setEditingMap] = useState<string | null>(null);
  const [mapName, setMapName] = useState('');
  const [guilds, setGuilds] = useState<Guild[]>([{ name: '' }]);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  const filteredData = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.map.localeCompare(b.map, 'es', { sensitivity: 'base' }));
    const query = search.trim().toLowerCase();
    if (!query) return sorted;
    return sorted.filter(
      (item) =>
        item.map.toLowerCase().includes(query) ||
        item.guilds.some((guild) => guild.name.toLowerCase().includes(query)),
    );
  }, [data, search]);

  const loadAll = useCallback(async () => {
    const { data: rows, error } = await supabase
      .from('mapas_hideouts')
      .select('map, guild_name, guild_type, lastEdited, radar');

    if (error) {
      flash('No se pudieron cargar los datos de Supabase');
      return;
    }

    const mapDict: Record<string, MapEntry> = {};
    const grouped: MapEntry[] = [];

    for (const row of rows ?? []) {
      if (row.radar !== RADAR_KEY) continue;
      const mapNameStr = row.map;
      if (!mapNameStr) continue;

      if (!mapDict[mapNameStr]) {
        mapDict[mapNameStr] = {
          id: mapNameStr,
          map: mapNameStr,
          guilds: [],
          lastEdited: row.lastEdited ?? undefined,
        };
        grouped.push(mapDict[mapNameStr]);
      }

      if (row.guild_name) {
        mapDict[mapNameStr].guilds.push({ name: row.guild_name });
      }
    }

    grouped.sort((a, b) => a.map.localeCompare(b.map, 'es', { sensitivity: 'base' }));

    grouped.forEach((mapEntry) => {
      mapEntry.guilds.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    });

    setData(grouped);
  }, []);

  useEffect(() => {
    let mounted = true;

    loadAll().finally(() => {
      if (mounted) setLoading(false);
    });

    const channel = supabase
      .channel('mapas_hideouts_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mapas_hideouts' },
        () => {
          if (mounted) loadAll();
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [loadAll]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4000);
  }

  function resetForm() {
    setEditingMap(null);
    setMapName('');
    setGuilds([{ name: '' }]);
  }

  function beginEdit(item: MapEntry) {
    setEditingMap(item.id);
    setMapName(item.map);
    setGuilds(item.guilds.length ? item.guilds : [{ name: '' }]);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  async function saveEntry() {
    const name = mapName.trim();
    const cleanGuilds = toDbGuilds(guilds);
    if (!name || !cleanGuilds.length) {
      flash(!name ? 'Escribe el nombre del mapa' : 'Agrega al menos un gremio');
      return;
    }
    setSaving(true);
    const lastEdited = new Date().toLocaleString('es-ES');

    try {
      const rowsToInsert = cleanGuilds.map((g) => ({
        map: name,
        guild_name: g.name,
        guild_type: 'HO',
        alliance_name: null,
        tier: null,
        calidad: null,
        lastEdited: lastEdited,
        radar: RADAR_KEY,
      }));

      // Limpia entradas anteriores si estamos editando o sobrescribiendo el mapa
      const targetMapToDelete = editingMap || name;
      const { error: delError } = await supabase
        .from('mapas_hideouts')
        .delete()
        .eq('map', targetMapToDelete)
        .eq('radar', RADAR_KEY);

      if (delError) throw delError;

      // Inserción directa en la tabla de Supabase (evita la función RPC defectuosa)
      const { error: insError } = await supabase
        .from('mapas_hideouts')
        .insert(rowsToInsert);

      if (insError) throw insError;

      flash(editingMap ? 'Mapa actualizado' : 'Mapa agregado');
      resetForm();
      await loadAll();
    } catch {
      flash('No se pudo guardar el mapa');
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entry: MapEntry) {
    if (!window.confirm(`¿Eliminar "${entry.map}"?`)) return;
    const { error } = await supabase
      .from('mapas_hideouts')
      .delete()
      .eq('map', entry.map)
      .eq('radar', RADAR_KEY);
    if (error) {
      flash('No se pudo eliminar el mapa');
      return;
    }
    flash('Mapa eliminado');
    await loadAll();
  }

  async function deleteSelected() {
    if (!selected.size) return;
    if (!window.confirm(`¿Eliminar ${selected.size} mapa(s) seleccionado(s)?`)) return;
    const maps = Array.from(selected);
    const { error } = await supabase
      .from('mapas_hideouts')
      .delete()
      .in('map', maps)
      .eq('radar', RADAR_KEY);
    if (error) {
      flash('No se pudieron eliminar los mapas');
      return;
    }
    flash(`${maps.length} mapa(s) eliminado(s)`);
    setSelected(new Set());
    setSelectMode(false);
    await loadAll();
  }

  function exitSelectMode() {
    setSelected(new Set());
    setSelectMode(false);
  }

  function toggleSelection(mapId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mapId)) next.delete(mapId);
      else next.add(mapId);
      return next;
    });
  }

  function exportData() {
    const exportable = data.map(({ map, guilds, lastEdited }) => ({
      map,
      guilds,
      lastEdited,
    }));
    const blob = new Blob([JSON.stringify(exportable, null, 2)], { type: 'application/json' });
    const url = URL.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `radar_albion_${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    flash('Archivo guardado');
  }

  async function importData(file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        flash('El archivo no es un JSON válido');
        return;
      }

      if (!Array.isArray(parsed)) {
        flash('El archivo debe contener un array de mapas');
        return;
      }

      const now = new Date().toLocaleString('es-ES');
      const rowsToInsert: {
        map: string;
        guild_name: string;
        guild_type: string;
        alliance_name: null;
        tier: null;
        calidad: null;
        lastEdited: string;
        radar: string;
      }[] = [];
      let importedCount = 0;
      let skippedCount = 0;

      for (const item of parsed) {
        if (!item || typeof item !== 'object') {
          skippedCount++;
          continue;
        }

        const raw = item as { map?: unknown; guilds?: unknown; lastEdited?: unknown };
        if (
          typeof raw.map !== 'string' ||
          !raw.map.trim() ||
          !Array.isArray(raw.guilds)
        ) {
          skippedCount++;
          continue;
        }

        const mapName = raw.map.trim();
        const guildList = raw.guilds as Guild[];
        const validGuilds = guildList.filter(
          (g) => g && typeof g.name === 'string' && g.name.trim(),
        );

        if (!validGuilds.length) {
          skippedCount++;
          continue;
        }

        importedCount++;
        for (const g of validGuilds) {
          rowsToInsert.push({
            map: mapName,
            guild_name: g.name.trim(),
            guild_type: 'HO',
            alliance_name: null,
            tier: null,
            calidad: null,
            lastEdited: (item as { lastEdited?: string }).lastEdited || now,
            radar: RADAR_KEY,
          });
        }
      }

      if (!rowsToInsert.length) {
        flash(
          skippedCount
            ? `No se importaron mapas. ${skippedCount} elemento(s) con formato inválido`
            : 'No se encontraron mapas en el archivo',
        );
        return;
      }

      try {
        const { error } = await supabase.from('mapas_hideouts').insert(rowsToInsert);
        if (error) throw error;
        flash(
          `Se importaron ${importedCount} mapa(s)` +
            (skippedCount ? `, se omitieron ${skippedCount} por formato inválido` : ''),
        );
        await loadAll();
      } catch {
        flash('No se pudieron guardar los datos importados');
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className={`app-shell ${darkMode ? 'theme-dark' : 'theme-light'}`}>
      <main className="main-content">
        <header className="topbar">
          <div className="brand-header">
            <div className="brand-mark">
              <img src="/image.png" alt="HO ZN" className="brand-logo" />
            </div>
            <div className="brand-text">
              <strong>HO ZN</strong>
              <span className="brand-subtitle">{RADAR_NAME}</span>
            </div>
          </div>
          <div className="top-actions">
            <button className="icon-button" onClick={() => setDarkMode(!darkMode)} title="Cambiar tema">
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <label className="file-button secondary-button">
              <FolderOpen size={16} /> Cargar
              <input
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  if (event.target.files?.[0]) importData(event.target.files[0]);
                  event.target.value = '';
                }}
              />
            </label>
            <button className="secondary-button" onClick={exportData}>
              <Download size={16} /> Guardar
            </button>
          </div>
        </header>

        <section className="page-heading">
          <div>
            <div className="eyebrow">MAPAS Y GREMIOS</div>
            <h1>{RADAR_NAME}</h1>
            <p>Consulta y organiza los gremios encontrados en cada mapa. Los cambios se ven al instante.</p>
          </div>
          <div className="stat-card">
            <span>MAPAS REGISTRADOS</span>
            <strong>{data.length.toString().padStart(2, '0')}</strong>
          </div>
        </section>

        <section className="content-card">
          <div className="toolbar">
            <div className="search-wrap">
              <Search size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar mapa o gremio..."
              />
            </div>
            {selectMode ? (
              <>
                <button
                  className="delete-button"
                  onClick={deleteSelected}
                  disabled={selected.size === 0}
                >
                  <Trash2 size={15} /> Eliminar ({selected.size})
                </button>
                <button className="clear-button cancel-select-button" onClick={exitSelectMode}>
                  <X size={15} /> Cancelar
                </button>
              </>
            ) : (
              <button className="secondary-button" onClick={() => setSelectMode(true)}>
                <Trash2 size={15} /> Eliminar
              </button>
            )}
            <span className="results-count">
              {loading ? 'Cargando...' : `${filteredData.length} resultados`}
            </span>
          </div>
          <div className="table-wrap">
            {loading ? (
              <div className="empty-state">
                <Loader2 size={34} className="spin" />
                <strong>Cargando datos...</strong>
                <span>Un momento por favor.</span>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    {selectMode && <th className="checkbox-col"></th>}
                    <th>MAPA</th>
                    <th>GREMIOS</th>
                    <th className="actions-header"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((item) => (
                    <tr
                      key={item.id}
                      className={selected.has(item.id) ? 'row-selected' : ''}
                      onClick={selectMode ? () => toggleSelection(item.id) : undefined}
                    >
                      {selectMode && (
                        <td className="checkbox-col" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(item.id)}
                            onChange={() => toggleSelection(item.id)}
                          />
                        </td>
                      )}
                      <td className="map-cell">
                        <strong>{item.map}</strong>
                      </td>
                      <td>
                        <div className="guild-list">
                          {item.guilds.map((guild, index) => (
                            <div className="guild-row" key={`${guild.name}-${index}`}>
                              <i />
                              <strong>{guild.name}</strong>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="actions-cell" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="secondary-button action-edit-btn"
                          onClick={() => beginEdit(item)}
                          title="Editar mapa"
                        >
                          <Pencil size={13} /> Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!filteredData.length && (
                    <tr>
                      <td colSpan={selectMode ? 4 : 3} className="empty-state">
                        <strong>{search ? 'No se encontraron resultados' : 'Todavía no hay mapas'}</strong>
                        <span>
                          {search
                            ? 'Prueba con otro término de búsqueda.'
                            : 'Agrega tu primer mapa usando el formulario inferior.'}
                        </span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="editor-card">
          <div className="editor-title">
            <div>
              <div className="eyebrow">GESTIÓN DE DATOS</div>
              <h2>{editingMap ? 'Editar mapa' : 'Agregar mapa'}</h2>
            </div>
            {editingMap && (
              <button className="clear-button" onClick={resetForm}>
                <X size={15} /> Cancelar edición
              </button>
            )}
          </div>
          <div className="editor-grid">
            <label>
              Nombre del mapa
              <input
                value={mapName}
                onChange={(event) => setMapName(event.target.value)}
                placeholder="Ej. Avalancha Ravine"
              />
            </label>
            <div>
              <div className="field-label">Gremios</div>
              {guilds.map((guild, index) => (
                <div className="guild-input-row" key={index}>
                  <input
                    value={guild.name}
                    onChange={(event) =>
                      setGuilds(
                        guilds.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, name: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder="Nombre del gremio"
                  />
                  {guilds.length > 1 && (
                    <button
                      className="remove-button"
                      onClick={() => setGuilds(guilds.filter((_, itemIndex) => itemIndex !== index))}
                      aria-label="Quitar gremio"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              ))}
              <button className="add-guild" onClick={() => setGuilds([...guilds, { name: '' }])}>
                <Plus size={15} /> Agregar otro gremio
              </button>
            </div>
          </div>
          <div className="editor-actions">
            <button className="primary-button" onClick={saveEntry} disabled={saving}>
              {saving ? <Loader2 size={17} className="spin" /> : <Plus size={17} />}{' '}
              {editingMap ? 'Guardar cambios' : 'Agregar'}
            </button>
            <button className="clear-button" onClick={resetForm}>
              Limpiar
            </button>
          </div>
        </section>
      </main>
      {notice && <div className="toast">{notice}</div>}
      <Analytics />
    </div>
  );
}

export default App;
