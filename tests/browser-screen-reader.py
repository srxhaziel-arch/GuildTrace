"""Run with Vite on localhost:5173 and Python Playwright + Chromium installed.
Uses a synthetic shared video with REAL browser OCR. All Supabase HTTP and
WebSocket traffic is intercepted; no production database is read or changed.
"""
import json
import os
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

ARTIFACTS = Path('/workspace/muestras/lector-implementado')
ARTIFACTS.mkdir(parents=True, exist_ok=True)
BASE_URL = os.environ.get('GUILDTRACE_TEST_URL', 'http://127.0.0.1:5173')
VIDEO_FIXTURE = """
window.__streams = [];
window.__shareCalls = 0;
window.__shareDenied = false;
window.__ocrCalls = 0;
const OriginalWorker = window.Worker;
window.Worker = class extends OriginalWorker {
  postMessage(message, ...args) {
    if (message.action === 'recognize') window.__ocrCalls++;
    return super.postMessage(message, ...args);
  }
};
Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {value: async (constraints) => {
  window.__captureConstraints = constraints;
  window.__shareCalls++;
  if (window.__shareDenied) throw new DOMException('Cancelled', 'NotAllowedError');
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d');
  window.__setCaptureText = (name, labelled = true) => {
    ctx.fillStyle = '#101821'; ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = '#1e2c39'; ctx.fillRect(100, 100, 1050, 280);
    ctx.fillStyle = '#f3f3f3'; ctx.font = '48px Arial';
    ctx.fillText((labelled ? 'Gremio: ' : '') + name, 150, 240);
  };
  window.__setSmallCaptureText = (name) => {
    ctx.fillStyle = '#18261d'; ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = '#25221e'; ctx.fillRect(110, 180, 460, 120);
    ctx.strokeStyle = '#6a5737'; ctx.strokeRect(110, 180, 460, 120);
    ctx.fillStyle = '#ded4ba'; ctx.font = '18px Georgia';
    ctx.fillText(name, 150, 240);
  };
  window.__setCaptureText('take care');
  const stream = canvas.captureStream(30);
  const animate = () => {
    if (stream.getVideoTracks()[0].readyState === 'live') {
      ctx.fillRect(0, 0, 1, 1); setTimeout(animate, 33);
    }
  };
  animate();
  window.__streams.push(stream);
  return stream;
}});
"""

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':1440, 'height':1050})
    context.add_init_script(VIDEO_FIXTURE)
    context.route_web_socket('**/realtime/v1/websocket*', lambda ws: None)
    rows = [{'id':1, 'map':'Avalanche Incline', 'guild_name':'ifures', 'guild_type':'HO', 'radar':'black-zone'}]
    writes = []
    fail_insert = [True]
    errors = []
    ocr_requests = []

    def network(route):
        request = route.request
        parsed = urlparse(request.url)
        if parsed.hostname in ['127.0.0.1', 'localhost']:
            if '/ocr/' in parsed.path: ocr_requests.append(parsed.path)
            route.continue_()
            return
        if parsed.path == '/rest/v1/mapas_hideouts':
            headers = {'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'*'}
            if request.method == 'OPTIONS':
                route.fulfill(status=204, headers=headers)
            elif request.method == 'GET':
                query = parse_qs(parsed.query)
                filtered = rows
                if 'map' in query:
                    filtered = [row for row in rows if row['map'] == query['map'][0].removeprefix('eq.')]
                route.fulfill(json=filtered, headers=headers)
            elif request.method == 'POST':
                payload = request.post_data_json
                writes.append(payload)
                if fail_insert[0]: route.fulfill(status=500, json={'message':'Simulated write failure'}, headers=headers)
                else:
                    rows.extend({**row, 'id':len(rows)+index+1} for index,row in enumerate(payload))
                    route.fulfill(status=201, body='', headers=headers)
            else:
                raise AssertionError('Unexpected database mutation: '+request.method)
            return
        route.abort()

    context.route('**/*', network)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE_URL, wait_until='domcontentloaded')
    page.get_by_role('button', name='Leer desde el juego', exact=True).click()
    expect(page.get_by_role('heading', name='Leer gremios desde Albion')).to_be_visible()
    assert not ocr_requests, 'OCR must not download before capture starts'
    page.get_by_role('button', name='Compartir ventana', exact=True).click()
    try:
        expect(page.locator('.detected-name')).to_have_count(1, timeout=60000)
    except Exception:
        page.screenshot(path=str(ARTIFACTS/'failure.png'), full_page=True)
        print('OCR FAILURE', page.locator('.screen-reader').inner_text(), errors, ocr_requests, flush=True)
        raise
    print('Real OCR detected first guild', flush=True)
    assert page.evaluate('window.__captureConstraints.video.frameRate.ideal') == 30
    expect(page.locator('.detected-name').first).to_have_value('take care')
    page.wait_for_timeout(2500)
    expect(page.locator('.detected-name')).to_have_count(1)
    assert page.evaluate('window.__ocrCalls') == 1, 'Static captures must not continually repeat expensive OCR'
    assert page.evaluate("document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames") > 20, 'Preview must keep playing while OCR runs'
    assert not writes, 'Detection must never save automatically'

    page.get_by_role('button', name='Pausar lectura', exact=True).click()
    page.evaluate("window.__setCaptureText('darkmight')")
    page.wait_for_timeout(2500)
    expect(page.locator('.detected-name')).to_have_count(1)
    page.get_by_role('button', name='Continuar lectura', exact=True).click()
    expect(page.locator('.detected-name')).to_have_count(2, timeout=20000)
    print('Pause/resume and second guild OK', flush=True)
    expect(page.locator('.detected-name').nth(1)).to_have_value('darkmight')

    # Leaving the view stops screen capture, but preserves the editable draft.
    page.get_by_role('button', name='Mapas y gremios', exact=True).click()
    assert page.evaluate("window.__streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))")
    page.get_by_role('button', name='Leer desde el juego', exact=True).click()
    expect(page.locator('.detected-name')).to_have_count(2)
    page.get_by_role('button', name='Compartir ventana', exact=True).click()
    expect(page.get_by_role('button', name='Pausar lectura', exact=True)).to_be_enabled(timeout=60000)
    page.evaluate("window.__setCaptureText('ifures')")
    expect(page.locator('.detected-name')).to_have_count(3, timeout=20000)
    print('Draft restoration and restarted capture OK', flush=True)

    # Choose a name-only crop, including a real OCR pass with no label.
    page.get_by_role('button', name='Marcar nombre', exact=True).click()
    preview = page.locator('.capture-preview').bounding_box()
    page.mouse.move(preview['x']+preview['width']*.09, preview['y']+preview['height']*.24)
    page.mouse.down()
    page.mouse.move(preview['x']+preview['width']*.7, preview['y']+preview['height']*.4)
    page.mouse.up()
    page.get_by_role('button', name='Usar zona', exact=True).click()
    expect(page.get_by_label('La zona contiene solo el nombre del gremio', exact=True)).to_be_checked()
    page.evaluate("window.__setSmallCaptureText('pivas')")
    expect(page.locator('.detected-name')).to_have_count(4, timeout=20000)
    print('Small serif text on a dark tooltip, name-only crop and real OCR OK', flush=True)
    expect(page.locator('.detected-name').nth(3)).to_have_value('pivas')
    page.get_by_role('button', name='Pausar lectura', exact=True).click()
    page.get_by_label('Guardar en el mapa', exact=True).fill('Avalanche Incline')
    save_button = page.get_by_role('button', name='Guardar 4 gremios', exact=True)
    expect(save_button).to_be_disabled()
    page.get_by_role('button', name='Marcar lista como revisada', exact=True).click()
    expect(save_button).to_be_enabled()

    # A correction must be reviewed again; manual duplicate edits cannot save.
    page.get_by_label('Nombre detectado 2', exact=True).fill('take care')
    expect(page.get_by_text('Hay nombres repetidos', exact=False)).to_be_visible()
    expect(save_button).to_be_disabled()
    page.get_by_label('Nombre detectado 2', exact=True).fill('darkmight')
    page.get_by_role('button', name='Marcar lista como revisada', exact=True).click()
    page.screenshot(path=str(ARTIFACTS/'escritorio.png'), full_page=True)
    save_button.click()
    expect(page.get_by_text('No se pudieron guardar los gremios.', exact=False)).to_be_visible()
    expect(page.locator('.detected-name')).to_have_count(4)
    assert [row['guild_name'] for row in writes[-1]] == ['take care','darkmight','pivas']
    fail_insert[0] = False
    save_button.click()
    expect(page.get_by_text('3 gremios añadidos', exact=False)).to_be_visible()
    expect(page.locator('.detected-name')).to_have_count(0)
    assert [row['guild_name'] for row in rows] == ['ifures','take care','darkmight','pivas']

    # Browser-level Stop sharing event also tears down capture.
    page.evaluate("window.__streams.at(-1).getVideoTracks()[0].dispatchEvent(new Event('ended'))")
    expect(page.get_by_role('button', name='Compartir ventana', exact=True)).to_be_visible()
    expect(page.get_by_label('La zona contiene solo el nombre del gremio', exact=True)).to_have_count(0)
    assert page.evaluate("window.__streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))")
    page.evaluate('window.__shareDenied = true')
    page.get_by_role('button', name='Compartir ventana', exact=True).click()
    expect(page.get_by_text('No se inició la captura.', exact=False)).to_be_visible()
    expect(page.get_by_role('button', name='Compartir ventana', exact=True)).to_be_enabled()

    page.set_viewport_size({'width':390,'height':1000})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(ARTIFACTS/'celular.png'), full_page=True)
    assert not errors, errors
    browser.close()
    print('PASS: real local OCR, deduplication, pause/resume, crop/name-only, draft restoration, review, append-only save, failed-save retention, screen-share cancellation, cleanup, mobile layout.')
