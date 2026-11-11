# Lectura de gremios desde pantalla

El apartado «Leer desde el juego» usa la captura de ventanas del navegador
(`getDisplayMedia`) y Tesseract.js 7. El usuario elige qué ventana comparte.
El vídeo y sus recortes se procesan localmente; solo los nombres revisados se
envían a la tabla existente `mapas_hideouts` al pulsar Guardar.

La captura requiere HTTPS (o localhost) y un navegador de escritorio compatible.
La lectura completa busca etiquetas en español o inglés; una zona seleccionada
se lee por defecto como un único nombre sin etiqueta. Se exigen dos imágenes
consecutivas coincidentes en el nombre y una confianza mínima de OCR. Esto reduce lecturas
accidentales, pero no garantiza la precisión en el juego: hay que probarlo con
sus fuentes, idioma, resolución y tooltip reales. No se intercambian I, l y 1.

La captura solicita 30 fps para la vista previa. El OCR tiene su propio ritmo,
adaptado al tiempo que tarda cada lectura, dejando descanso entre trabajos.
Los recortes se limitan a 400.000 píxeles. Las imágenes cuyo resumen de color
no cambia reutilizan el resultado de OCR anterior, evitando reconocer una
pantalla estática repetidamente. «Ver qué texto está leyendo» permite comprobar
si falla la lectura del texto o la identificación del gremio.

Los nombres pendientes y el mapa se conservan en sessionStorage de la pestaña,
sin fotogramas. Salir del apartado detiene las pistas de vídeo y el worker.
Pausar detiene la lectura, pero mantiene la ventana compartida. Detener también
cierra la captura. Guardar pausa la lectura y permite continuar en otro mapa.

El guardado consulta primero los nombres existentes, omite repetidos y añade
los nuevos en orden, sin eliminar registros. Un fallo conserva la lista para
reintentar. La tabla no tiene aquí una restricción nueva de unicidad: dos
sesiones que inserten el mismo gremio simultáneamente podrían duplicarlo.

El código OCR se carga solo al iniciar la captura. `predev` y `prebuild` copian
el worker y sus motores desde las dependencias instaladas a public/ocr; los
modelos inglés y español están versionados con su procedencia y hashes en
public/ocr/tessdata-fast-v4/sources.json. No se usa un CDN externo en ejecución.

Validación: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
`tests/browser-screen-reader.py` usa Playwright Python y Chromium con un vídeo
sintético y OCR real. Intercepta todo el tráfico de Supabase para verificar el
guardado sin leer ni modificar la base de producción. Acepta la variable
GUILDTRACE_TEST_URL para ejecutarse contra el servidor de desarrollo o preview.
