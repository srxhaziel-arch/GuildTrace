import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Check, CheckCheck, Crop, Info, Loader2, MonitorUp, Pause, Play, Plus, ScanLine, Square, X } from 'lucide-react';
import { addDetection, guildKey, readCaptureDraft, writeCaptureDraft, type CaptureRegion, type DetectedGuild } from '@/lib/screen-reader';
import { useScreenCapture } from '@/lib/use-screen-capture';
import './screen-reader.css';

type Props = {
  maps: string[];
  online: boolean;
  onSave: (map: string, names: string[]) => Promise<{ added: number; skipped: number }>;
};

export default function ScreenReader({ maps, online, onSave }: Props) {
  const [draft] = useState(readCaptureDraft);
  const [guilds, setGuilds] = useState<DetectedGuild[]>(draft.guilds);
  const [map, setMap] = useState(draft.map);
  const [region, setRegion] = useState<CaptureRegion | null>(null);
  const [selection, setSelection] = useState<CaptureRegion | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [nameOnly, setNameOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const seenNames = useRef(new Set(draft.guilds.map((guild) => guildKey(guild.name))));
  const stage = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const onDetected = useCallback((name: string) => {
    const key = guildKey(name);
    if (seenNames.current.has(key)) return;
    seenNames.current.add(key);
    setGuilds((previous) => previous.length < 200 ? addDetection(previous, name) : previous);
  }, []);
  const capture = useScreenCapture({ region, nameOnly, selecting }, onDetected);
  const sharing = ['loading', 'active', 'paused'].includes(capture.phase);
  const starting = ['requesting', 'loading'].includes(capture.phase);
  const duplicate = guilds.some((guild, index) => guilds.findIndex((other) => guildKey(other.name) === guildKey(guild.name)) !== index);
  const reviewed = guilds.length > 0 && guilds.every((guild) => guild.reviewed && guild.name.trim());
  const canSave = reviewed && !duplicate && !!map.trim() && online && !saving;

  useEffect(() => { writeCaptureDraft(map, guilds); }, [map, guilds]);
  useEffect(() => {
    if (!sharing) {
      setSelecting(false);
      setRegion(null);
      setNameOnly(false);
    }
  }, [sharing]);

  function updateGuild(id: string, change: Partial<DetectedGuild>) {
    setMessage('');
    setGuilds((previous) => previous.map((guild) => guild.id === id ? { ...guild, ...change } : guild));
  }

  function beginSelection() {
    setSelection(region ?? { x: .25, y: .25, width: .5, height: .3 });
    setSelecting(true);
    requestAnimationFrame(() => stage.current?.focus());
  }

  function point(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!selecting || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = point(event);
    setSelection({ ...dragOrigin.current, width: 0, height: 0 });
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!selecting || !dragOrigin.current) return;
    const current = point(event);
    const origin = dragOrigin.current;
    setSelection({ x: Math.min(current.x, origin.x), y: Math.min(current.y, origin.y), width: Math.abs(current.x - origin.x), height: Math.abs(current.y - origin.y) });
  }

  function finishSelection() {
    if (!selection || selection.width < .015 || selection.height < .015) return;
    setRegion(selection);
    setNameOnly(true);
    setSelecting(false);
  }

  function keySelection(event: KeyboardEvent<HTMLDivElement>) {
    if (!selecting || !selection) return;
    if (event.key === 'Escape') { event.preventDefault(); setSelecting(false); return; }
    if (event.key === 'Enter') { event.preventDefault(); finishSelection(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const deltaX = event.key === 'ArrowLeft' ? -.01 : event.key === 'ArrowRight' ? .01 : 0;
    const deltaY = event.key === 'ArrowUp' ? -.01 : event.key === 'ArrowDown' ? .01 : 0;
    setSelection(event.shiftKey ? {
      ...selection, width: Math.max(.02, Math.min(1 - selection.x, selection.width + deltaX)), height: Math.max(.02, Math.min(1 - selection.y, selection.height + deltaY)),
    } : {
      ...selection, x: Math.max(0, Math.min(1 - selection.width, selection.x + deltaX)), y: Math.max(0, Math.min(1 - selection.height, selection.y + deltaY)),
    });
  }

  async function save() {
    if (!canSave) return;
    capture.pause();
    setSaving(true);
    setSaveError('');
    setMessage('');
    const submitted = new Set(guilds.map((guild) => guild.id));
    try {
      const result = await onSave(map.trim(), guilds.map((guild) => guild.name.trim()));
      setGuilds((previous) => previous.filter((guild) => !submitted.has(guild.id)));
      seenNames.current.clear();
      setMessage(`${result.added} ${result.added === 1 ? 'gremio añadido' : 'gremios añadidos'} a ${map.trim()}.${result.skipped ? ` ${result.skipped} ya estaban en el mapa.` : ''} Puedes elegir otro mapa y continuar leyendo.`);
    } catch {
      setSaveError('No se pudieron guardar los gremios. Tu lista sigue aquí; revisa la conexión y reintenta.');
    } finally { setSaving(false); }
  }

  const activeRegion = selecting ? selection : region;
  return (
    <section className="screen-reader" aria-labelledby="reader-title">
      <div className="reader-heading">
        <div className="eyebrow">LECTURA DE PANTALLA · PRUEBA</div>
        <h2 id="reader-title">Leer gremios desde Albion</h2>
        <p>Comparte la ventana del juego y pasa el cursor por cada HO. Los nombres se añaden a la misma lista.</p>
      </div>
      <div className="reader-layout">
        <section className="reader-panel capture-panel" aria-labelledby="capture-title">
          <div className="reader-panel-heading">
            <h3 id="capture-title">Ventana compartida</h3>
            <span className={`capture-badge ${sharing ? 'is-sharing' : ''}`}><i />{capture.phase === 'active' ? 'Leyendo' : capture.phase === 'paused' ? 'Lectura pausada' : capture.phase === 'loading' ? 'Preparando lector' : 'Sin captura'}</span>
          </div>
          <div ref={stage} className={`capture-preview ${selecting ? 'is-selecting' : ''}`} style={{ aspectRatio: capture.aspect }} tabIndex={selecting ? 0 : -1} role="group" aria-label="Vista de la ventana compartida. Para seleccionar: arrastra un rectángulo, o mueve con flechas, cambia tamaño con Mayúsculas y flechas y confirma con Enter." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { dragOrigin.current = null; }} onPointerCancel={() => { dragOrigin.current = null; }} onKeyDown={keySelection}>
            <video ref={capture.videoRef} autoPlay muted playsInline aria-label="Ventana del juego compartida" />
            {!sharing && <div className="capture-empty"><MonitorUp size={42} strokeWidth={1.2} /><strong>Tu ventana de Albion aparecerá aquí</strong><span>Abre el mapa del juego y muestra la información de un HO al pasar el cursor.</span></div>}
            {sharing && activeRegion && <div className="capture-region" style={{ left: `${activeRegion.x * 100}%`, top: `${activeRegion.y * 100}%`, width: `${activeRegion.width * 100}%`, height: `${activeRegion.height * 100}%` }}><span>{nameOnly ? 'Solo nombre' : 'Zona de lectura'}</span></div>}
          </div>
          <div className="capture-controls">
            {sharing ? <>
              <button className="secondary-button" onClick={capture.phase === 'paused' ? capture.resume : capture.pause} disabled={starting || saving || selecting}>{capture.phase === 'paused' ? <Play size={15} /> : <Pause size={15} />}{capture.phase === 'paused' ? 'Continuar lectura' : 'Pausar lectura'}</button>
              <button className="clear-button" onClick={() => { capture.stop(); setSelecting(false); setRegion(null); setNameOnly(false); }} disabled={saving}><Square size={13} /> Detener captura</button>
            </> : <button className="primary-button" onClick={() => void capture.start()} disabled={!capture.supported || starting || saving}>{starting ? <Loader2 size={16} className="spin" /> : <MonitorUp size={17} />}{starting ? 'Esperando selección…' : 'Compartir ventana'}</button>}
            {sharing && !starting && !selecting && <button className={region ? 'clear-button' : 'primary-button'} onClick={beginSelection} disabled={saving}><Crop size={15} />{region ? 'Cambiar zona' : 'Marcar nombre'}</button>}
            {selecting && <><button className="primary-button" onClick={finishSelection} disabled={!selection || selection.width < .015 || selection.height < .015}>Usar zona</button><button className="clear-button" onClick={() => setSelecting(false)}>Cancelar selección</button></>}
          </div>
          {selecting && <p className="capture-help">Encierra solo las letras del nombre, dejando un pequeño margen, y pulsa «Usar zona». No incluyas el resto del mapa. Con teclado: flechas para mover, Mayúsculas + flechas para ajustar el tamaño.</p>}
          {sharing && region && !selecting && <div className="capture-region-options"><label><input type="checkbox" checked={nameOnly} onChange={(event) => setNameOnly(event.target.checked)} disabled={saving} />La zona contiene solo el nombre del gremio</label><button className="clear-button" onClick={() => { setRegion(null); setNameOnly(false); }} disabled={saving}>Leer toda la ventana</button></div>}
          <p className="capture-status" role="status"><ScanLine size={16} />{capture.phase === 'paused' ? 'Lectura pausada. Puedes revisar la lista o continuar con otro HO.' : capture.status}</p>
          {capture.error && <p className="reader-error" role="alert">{capture.error}</p>}
          {capture.reading && <details className="reader-instructions reading-result"><summary>Ver qué texto está leyendo</summary><p>{capture.reading.candidate ? `Nombre reconocido: ${capture.reading.candidate}` : 'Todavía no se reconoció un nombre. Este es el texto que pudo leer:'}</p><pre>{capture.reading.text || 'No se encontró texto legible.'}</pre></details>}
          {!capture.supported && <p className="reader-error">La captura de ventanas requiere un navegador compatible en un ordenador. Prueba Chrome o Edge con la web abierta mediante HTTPS.</p>}
          <details className="reader-instructions"><summary>Consejos para que lea mejor</summary><ul><li>Comparte la ventana de Albion y deja visible la información del HO durante unos segundos.</li><li>Si no detecta el gremio, pulsa «Marcar nombre» y selecciona solo sus letras. Este modo funciona sin «Gremio» ni «Owner» delante.</li><li>Si seleccionas un cuadro que también tiene etiquetas y otros datos, desactiva «La zona contiene solo el nombre del gremio».</li><li>Si la información cambia de lugar, vuelve a marcar la zona. Aumentar el tamaño de la interfaz del juego también puede ayudar.</li></ul></details>
        </section>
        <section className="reader-panel detected-panel" aria-labelledby="detected-title">
          <div className="reader-panel-heading"><h3 id="detected-title">Gremios detectados <span className="field-count">{guilds.length}</span></h3></div>
          <p className="detected-description">Corrige los nombres y marca la lista como revisada.</p>
          <fieldset className="detected-fields" disabled={saving}>
            <div className="detected-list">
              {!guilds.length && <div className="detected-empty"><ScanLine size={28} /><strong>Esperando el primer gremio</strong><span>Los nombres aparecerán aquí mientras recorres los HO.</span></div>}
              {guilds.map((guild, index) => <div className={`detected-row ${guild.reviewed ? 'is-reviewed' : ''}`} key={guild.id}>
                <input type="checkbox" className="review-check" checked={guild.reviewed} onChange={(event) => updateGuild(guild.id, { reviewed: event.target.checked })} aria-label={`Revisado: ${guild.name || `gremio ${index + 1}`}`} />
                <input className="detected-name" value={guild.name} onFocus={capture.pause} onChange={(event) => updateGuild(guild.id, { name: event.target.value, reviewed: false })} aria-label={`Nombre detectado ${index + 1}`} maxLength={100} />
                <button className="remove-button" onClick={() => setGuilds((previous) => previous.filter((item) => item.id !== guild.id))} aria-label={`Quitar ${guild.name || `gremio ${index + 1}`}`}><X size={16} /></button>
              </div>)}
            </div>
            {guilds.length > 0 && <button className="clear-button review-all" onClick={() => setGuilds((previous) => previous.map((guild) => ({ ...guild, reviewed: !!guild.name.trim() })))}><CheckCheck size={15} />Marcar lista como revisada</button>}
            <button className="clear-button manual-guild" onClick={() => setGuilds((previous) => [...previous, { id: crypto.randomUUID(), name: '', reviewed: false }])} disabled={guilds.length >= 200}><Plus size={14} />Añadir nombre manualmente</button>
            <p className="capture-help">Los repetidos se omiten. Se conserva el orden de lectura.</p>
            <p className="reader-spelling"><Info size={15} />Comprueba letras parecidas: I / l / 1. No se corrigen automáticamente.</p>
            {guilds.length >= 200 && <p className="reader-error">Lista completa: guarda o quita nombres antes de continuar.</p>}
            {duplicate && <p className="reader-error" role="alert">Hay nombres repetidos en la lista. Quita uno antes de guardar.</p>}
            <label className="reader-map-label" htmlFor="capture-map">Guardar en el mapa</label>
            <input id="capture-map" className="reader-map-input" list="capture-map-options" value={map} onChange={(event) => setMap(event.target.value)} placeholder="Elige un mapa o escribe uno nuevo" maxLength={150} />
            <datalist id="capture-map-options">{maps.map((name) => <option key={name} value={name} />)}</datalist>
            <button className="primary-button save-captured" onClick={() => void save()} disabled={!canSave}>{saving ? <Loader2 size={17} className="spin" /> : <Check size={17} />}{saving ? 'Guardando…' : `Guardar ${guilds.length} ${guilds.length === 1 ? 'gremio' : 'gremios'}`}</button>
          </fieldset>
          <p className="reader-save-note">{!online ? 'Sin conexión. Conserva esta pestaña abierta y guarda al reconectar.' : guilds.length && !reviewed ? 'Revisa los nombres para habilitar el guardado.' : 'Se añadirán al mapa sin borrar los gremios que ya tenga.'}</p>
          {message && <p className="reader-success" role="status">{message}</p>}
          {saveError && <p className="reader-error" role="alert">{saveError}</p>}
        </section>
      </div>
      <p className="reader-privacy"><Info size={16} />La imagen se procesa en tu navegador y no se envía a servidores. Al salir de este apartado se detiene la captura. La lista pendiente se conserva en esta pestaña.</p>
    </section>
  );
}
