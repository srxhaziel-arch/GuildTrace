import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function toDbGuilds(guilds: Guild[]) {
  return guilds.filter((g) => g.name.trim()).map((g) => ({
    name: g.name.trim(),
  }));
}

function LoadingMaps() {
  return (
    <div className="loading-maps" role="status" aria-label="Cargando mapas">
      <span className="sr-only">Cargando mapas y gremios…</span>
      <table aria-hidden="true">
        <thead><tr><th>MAPA</th><th>GREMIOS</th><th className="actions-header" /></tr></thead>
        <tbody>
          {Array.from({ length: 7 }, (_, index) => (
            <tr className="skeleton-row" key={index}>
              <td className="map-cell">
                <span className="skeleton skeleton-name" />
                <span className="skeleton skeleton-count" />
              </td>
              <td><div className="skeleton-guilds">
                {Array.from({ length: index % 3 + 2 }, (_, guildIndex) =>
                  <span className="skeleton skeleton-chip" key={guildIndex} />)}
              </div></td>
              <td className="actions-cell"><span className="skeleton skeleton-button" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [data, setData] = useState<MapEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingMap, setEditingMap] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const editorDialog = useRef<HTMLDialogElement>(null);
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

  useEffect(() => {
    const dialog = editorDialog.current;
    if (!editorOpen || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [editorOpen]);

  const filteredData = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.flatMap((item) => {
      const matchesMap = !query || item.map.toLowerCase().includes(query);
      const visibleGuilds = matchesMap
        ? item.guilds
        : item.guilds.filter((guild) => guild.name.toLowerCase().includes(query));
      return matchesMap || visibleGuilds.length ? [{ ...item, visibleGuilds }] : [];
    });
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
    setEditorOpen(false);
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

  function beginAdd() {
    if (!canLeaveForm()) return;
    clearForm();
    setSaveStatus('idle');
    setNotice('');
    setSelectMode(false);
    setSelected(new Set());
    setEditorOpen(true);
  }

  function beginEdit(item: MapEntry) {
    if (editingMap === item.id) return;
    if (!canLeaveForm()) return;
    const initialGuilds = item.guilds.length ? item.guilds : [{ name: '' }];
    setFormBaseline(JSON.stringify([item.map, initialGuilds]));
    setSaveStatus('idle');
    setEditorOpen(true);
    setNotice('');
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
          <button className="clear-button" onClick={resetForm} aria-label="Cerrar formulario">
            <X size={15} /> Cerrar
          </button>
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
            <div className="field-label">Gremios <span className="field-count">{guilds.length}</span></div>
            <p className="field-hint">Se mostrarán en este mismo orden.</p>
            {guilds.map((guild, index) => (
              <div className="guild-input-row" key={index}>
                <input
                  aria-label={`Gremio ${index + 1}`}
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
        <div className="editor-footer">
          <div className="editor-actions">
            <button className="primary-button" onClick={saveEntry} disabled={busy || !online}>
              {saving ? <Loader2 size={17} className="spin" /> : <Plus size={17} />}{' '}
              {saving ? 'Guardando…' : editingMap ? 'Guardar cambios' : 'Agregar'}
            </button>
            <button className="clear-button" onClick={resetForm}>
              Cancelar
            </button>
          </div>
          <p className="form-status" role="status">
            {!online ? 'Sin conexión. Tu edición sigue abierta; espera a reconectar para guardar.' : saving ? 'Guardando cambios…' : saveStatus === 'error' ? 'No se pudo guardar. Tus cambios siguen en el formulario.' : dirty ? 'Cambios sin guardar' : saveStatus === 'saved' ? 'Cambios guardados' : 'Completa los datos del mapa.'}
          </p>
          {notice && <p className="form-notice" role="alert">{notice}</p>}
        </div>
      </fieldset>
    </section>
  );

  return (
    <div className="app-shell theme-dark">
      <main className="main-content">
        <header className="topbar">
          <div className="brand-header">
            <div className="brand-mark">
              <img
                src="/brand/guildtrace-logo-64.6a5e6cc871.webp"
                srcSet="/brand/guildtrace-logo-64.6a5e6cc871.webp 64w, /brand/guildtrace-logo-128.203dae3659.webp 128w"
                sizes="38px"
                width={38}
                height={38}
                decoding="async"
                alt="GuildTrace"
                className="brand-logo"
              />
            </div>
            <div className="brand-text">
              <h1>GuildTrace</h1>
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

        <section className="page-heading" aria-label="Resumen de mapas y gremios">
          <div className="heading-tools">
            <div className="summary-stats" role="status" aria-label="Resumen de resultados">
              <div className="stat-card">
                <span>{search.trim() ? `MAPAS · DE ${data.length}` : 'MAPAS'}</span>
                <strong>{loading ? '…' : filteredData.length}</strong>
              </div>
              <div className="stat-card">
                <span>GREMIOS</span>
                <strong>{loading ? '…' : filteredData.reduce((sum, item) => sum + item.visibleGuilds.length, 0)}</strong>
              </div>
            </div>
            <button className="primary-button" onClick={beginAdd} disabled={busy} aria-haspopup="dialog" aria-controls="map-editor">
              <Plus size={17} /> Agregar mapa
            </button>
          </div>
        </section>

        <section className="content-card" aria-busy={loading}>
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
          </div>
          {selectMode && (
            <p className="selection-hint">Pulsa en cualquier parte de una fila para seleccionar o quitar la selección del mapa.</p>
          )}
          <div className="table-wrap">
            {loading ? (
              <LoadingMaps />
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
                        <span className="guild-count">
                          {item.visibleGuilds.length < item.guilds.length
                            ? `${item.visibleGuilds.length} de ${item.guilds.length} gremios`
                            : `${item.guilds.length} ${item.guilds.length === 1 ? 'gremio' : 'gremios'}`}
                        </span>
                      </td>
                      <td>
                        <div className="guild-list">
                          {item.visibleGuilds.map((guild, index) => (
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
                          aria-haspopup={selectMode ? undefined : 'dialog'}
                          aria-controls={selectMode ? undefined : 'map-editor'}
                        >
                          {selectMode ? (selected.has(item.id) ? 'Quitar selección' : 'Seleccionar') : <><Pencil size={13} /> Editar</>}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!filteredData.length && (
                    <tr>
                      <td colSpan={selectMode ? 4 : 3} className="empty-state">
                        <strong>{dataError && !data.length ? 'No se pudieron cargar los mapas' : search ? 'No se encontraron resultados' : 'Todavía no hay mapas'}</strong>
                        <span>
                          {dataError && !data.length ? 'Reintenta la carga desde el aviso superior.' : search
                            ? 'Prueba con otro término de búsqueda.'
                            : 'Pulsa «Agregar mapa» para registrar el primero.'}
                        </span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
      <dialog
        ref={editorDialog}
        id="map-editor"
        className="map-editor-dialog"
        aria-label={editingMap ? 'Editar mapa' : 'Agregar mapa'}
        onCancel={(event) => { event.preventDefault(); resetForm(); }}
      >
        {editorOpen && editor}
      </dialog>
      {notice && <div className="toast">{notice}</div>}
      <Analytics />
    </div>
  );
}

export default App;
