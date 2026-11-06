import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
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
    document.documentElement.classList.add('dark');
  }, []);

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

  const editor = (
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
  );

  return (
    <div className="app-shell theme-dark">
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
          {selectMode && (
            <p className="selection-hint">Pulsa en cualquier parte de una fila para seleccionar o quitar la selección del mapa.</p>
          )}
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
                    <Fragment key={item.id}>
                      <tr
                        className={`${selectMode ? 'row-selectable' : ''} ${selected.has(item.id) ? 'row-selected' : ''}`}
                        onClick={selectMode ? () => toggleSelection(item.id) : undefined}
                      >
                        {selectMode && (
                          <td className="checkbox-col">
                            <input
                              type="checkbox"
                              aria-label={`Seleccionar ${item.map}`}
                              onClick={(event) => event.stopPropagation()}
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
                        <td className="actions-cell">
                          <button
                            className="secondary-button action-edit-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (selectMode) toggleSelection(item.id);
                              else beginEdit(item);
                            }}
                            title={selectMode ? 'Seleccionar mapa para eliminar' : 'Editar mapa'}
                            aria-pressed={selectMode ? selected.has(item.id) : undefined}
                            aria-expanded={selectMode ? undefined : editingMap === item.id}
                            aria-controls={!selectMode && editingMap === item.id ? 'map-editor' : undefined}
                          >
                            {selectMode ? (selected.has(item.id) ? 'Quitar selección' : 'Seleccionar') : <><Pencil size={13} /> Editar</>}
                          </button>
                        </td>
                      </tr>
                      {editingMap === item.id && (
                        <tr className="inline-editor-row" id="map-editor">
                          <td colSpan={selectMode ? 4 : 3}>{editor}</td>
                        </tr>
                      )}
                    </Fragment>
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

        {!editingMap && editor}
      </main>
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

export default App;
