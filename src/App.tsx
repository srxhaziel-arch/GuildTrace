import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  WifiOff,
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
  const [online, setOnline] = useState(navigator.onLine);
  const [dataError, setDataError] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [deleting, setDeleting] = useState(false);
  const [formBaseline, setFormBaseline] = useState(JSON.stringify(['', [{ name: '' }]]));
  const dirty = JSON.stringify([mapName, guilds]) !== formBaseline;
  const busy = saving || deleting;

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);

  const filteredData = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.filter((item) =>
      item.map.toLowerCase().includes(query) ||
      item.guilds.some((guild) => guild.name.toLowerCase().includes(query)),
    );
  }, [data, search]);

  const loadAll = useCallback(async () => {
    const { data: rows, error } = await supabase
      .from('mapas_hideouts')
      // El id secuencial conserva el orden de inserción de los gremios, también al recargar.
      .select('map, guild_name, guild_type, lastEdited, radar')
      .order('id', { ascending: true });

    if (error) {
      setDataError(true);
      flash('No se pudieron actualizar los datos. Puedes reintentar.');
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

    setData(grouped);
    setDataError(false);
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
      .subscribe((status) => {
        if (mounted) {
          if (status === 'SUBSCRIBED') void loadAll();
        }
      });

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [loadAll, online]);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4000);
  }

  function clearForm() {
    setFormBaseline(JSON.stringify(['', [{ name: '' }]]));
    setEditingMap(null);
    setMapName('');
    setGuilds([{ name: '' }]);
  }

  function canLeaveForm() {
    return !busy && (!dirty || window.confirm('Tienes cambios sin guardar. ¿Quieres descartarlos?'));
  }

  function resetForm() {
    if (canLeaveForm()) {
      clearForm();
      setSaveStatus('idle');
    }
  }

  function changeView(change: () => void) {
    if (editingMap && !canLeaveForm()) return;
    if (editingMap) clearForm();
    change();
  }

  function beginEdit(item: MapEntry) {
    if (editingMap === item.id) return;
    if (!canLeaveForm()) return;
    const initialGuilds = item.guilds.length ? item.guilds : [{ name: '' }];
    setFormBaseline(JSON.stringify([item.map, initialGuilds]));
    setSaveStatus('idle');
    setEditingMap(item.id);
    setMapName(item.map);
    setGuilds(item.guilds.length ? item.guilds : [{ name: '' }]);
  }

  async function saveEntry() {
    if (busy || !online) return;
    const name = mapName.trim();
    const cleanGuilds = toDbGuilds(guilds);
    if (!name || !cleanGuilds.length) {
      flash(!name ? 'Escribe el nombre del mapa' : 'Agrega al menos un gremio');
      return;
    }
    setSaving(true);
    setSaveStatus('idle');
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
      clearForm();
      setSaveStatus('saved');
      await loadAll();
    } catch {
      setSaveStatus('error');
      flash('No se pudo guardar el mapa. Revisa la conexión antes de reintentar.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelected() {
    if (!selected.size || busy || !online) return;
    if (dirty && !canLeaveForm()) return;
    if (!window.confirm(`¿Eliminar ${selected.size} mapa(s) seleccionado(s)?`)) return;
    setDeleting(true);
    const maps = Array.from(selected);
    const { error } = await supabase
      .from('mapas_hideouts')
      .delete()
      .in('map', maps)
      .eq('radar', RADAR_KEY);
    setDeleting(false);
    if (error) {
      flash('No se pudieron eliminar los mapas');
      return;
    }
    clearForm();
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
    <section className="editor-card" aria-label={editingMap ? `Editar ${editingMap}` : 'Agregar mapa'}>
      <fieldset disabled={busy} className="editor-fields">
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
        <button className="primary-button" onClick={saveEntry} disabled={busy || !online}>
          {saving ? <Loader2 size={17} className="spin" /> : <Plus size={17} />}{' '}
          {saving ? 'Guardando…' : editingMap ? 'Guardar cambios' : 'Agregar'}
        </button>
        <button className="clear-button" onClick={resetForm}>
          Limpiar
        </button>
      </div>
      <p className="form-status" role="status">
        {saving ? 'Guardando cambios…' : saveStatus === 'error' ? 'No se pudo guardar. Tus cambios siguen en el formulario.' : dirty ? 'Cambios sin guardar' : saveStatus === 'saved' ? 'Cambios guardados' : 'Completa los datos del mapa.'}
      </p>
      </fieldset>
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
          {(!online || dataError || saving || dirty || saveStatus === 'saved') && (
            <div className={`connection-status ${!online || dataError ? 'connection-warning' : ''}`} role="status">
              {!online ? <WifiOff size={16} /> : saving ? <Loader2 size={16} className="spin" /> : !dirty && saveStatus === 'saved' ? <Check size={16} /> : null}
              {!online ? 'Sin conexión' : dataError ? 'Error al actualizar' : saving ? 'Guardando…' : dirty ? 'Sin guardar' : 'Guardado'}
            </div>
          )}
        </header>
        {(!online || dataError) && (
          <div className="connection-banner" role="status">
            <span>{!online ? 'Sin conexión. Conservamos tu edición abierta; no cierres esta pestaña. Guardar y eliminar estarán disponibles al reconectar.' : 'No se pudieron actualizar los mapas. Se muestran los últimos datos cargados.'}</span>
            {online && <button className="secondary-button" onClick={() => void loadAll()}>Reintentar</button>}
          </div>
        )}

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
                onChange={(event) => changeView(() => setSearch(event.target.value))}
                aria-label="Buscar mapa o gremio"
                disabled={busy}
                placeholder="Buscar mapa o gremio..."
              />
            </div>
            {selectMode ? (
              <>
                <button
                  className="delete-button"
                  onClick={deleteSelected}
                  disabled={selected.size === 0 || busy || !online}
                >
                  <Trash2 size={15} /> {deleting ? 'Eliminando…' : `Eliminar (${selected.size})`}
                </button>
                <button className="clear-button cancel-select-button" onClick={exitSelectMode} disabled={busy}>
                  <X size={15} /> Cancelar
                </button>
              </>
            ) : (
              <button className="secondary-button" onClick={() => { if (canLeaveForm()) { clearForm(); setSelectMode(true); } }} disabled={busy}>
                <Trash2 size={15} /> Eliminar
              </button>
            )}
            <span className="results-count">
              {loading ? 'Cargando...' : `${filteredData.length} de ${data.length} mapas · ${filteredData.reduce((sum, item) => sum + item.guilds.length, 0)} gremios`}
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
                        className={`map-row ${selectMode ? 'row-selectable' : ''} ${selected.has(item.id) ? 'row-selected' : ''}`}
                        onClick={selectMode && !busy ? () => toggleSelection(item.id) : undefined}
                      >
                        {selectMode && (
                          <td className="checkbox-col">
                            <input
                              type="checkbox"
                              disabled={busy}
                              aria-label={`Seleccionar ${item.map}`}
                              onClick={(event) => event.stopPropagation()}
                              checked={selected.has(item.id)}
                              onChange={() => toggleSelection(item.id)}
                            />
                          </td>
                        )}
                        <td className="map-cell">
                          <strong>{item.map}</strong>
                          <span className="guild-count">{item.guilds.length} {item.guilds.length === 1 ? 'gremio' : 'gremios'}</span>
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
                            disabled={busy}
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
                        <strong>{dataError && !data.length ? 'No se pudieron cargar los mapas' : search ? 'No se encontraron resultados' : 'Todavía no hay mapas'}</strong>
                        <span>
                          {dataError && !data.length ? 'Reintenta la carga desde el aviso superior.' : search
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

        {(!editingMap || !filteredData.some((item) => item.id === editingMap)) && editor}
      </main>
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

export default App;
