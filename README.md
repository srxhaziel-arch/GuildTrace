# GuildTrace

Aplicación para consultar y gestionar mapas y gremios de la Zona Negra de Albion Online.
Desarrollada con React, TypeScript y Vite, con datos y actualizaciones en tiempo real mediante Supabase.

## Desarrollo local

Requisitos: Node.js y npm. Validado con Node.js 24 y npm 11.

1. Instala las dependencias con `npm ci`.
2. Crea un archivo `.env.local` en la raíz del proyecto con:

   ```dotenv
   VITE_SUPABASE_URL=https://<proyecto>.supabase.co
   VITE_SUPABASE_ANON_KEY=<clave-publica-anon-o-publishable>
   ```

   Usa únicamente la clave pública del proyecto; nunca una clave `service_role`.
   Las variables `VITE_*` forman parte del código que recibe el navegador.

3. Ejecuta `npm run dev`.

La aplicación utiliza la tabla existente `mapas_hideouts` de Supabase. Las migraciones
del repositorio no crean esa tabla desde cero. No las ejecutes automáticamente sobre
una base existente: una de ellas vacía los campos `tier`, `calidad` y `alliance_name`.

## Comprobaciones

- `npm run build`: genera la versión de producción en `dist/`.
- `npm run typecheck`: comprueba los tipos de TypeScript.
- `npm run lint`: comprueba las reglas de ESLint.
- `npm run preview`: sirve localmente la compilación de producción.

## Despliegue

El proyecto de Vercel está conectado al repositorio de GitHub. Los cambios de la rama
de producción activan el despliegue automático. Configura en Vercel las mismas
variables de Supabase antes de compilar.

Configuración de compilación: `npm run build`. Directorio de salida: `dist`.

## Recursos y caché

La cabecera usa versiones WebP de 64 y 128 píxeles del logo, y el favicon tiene su
propio PNG pequeño. El original se conserva en `design/guildtrace-master.png` y no
se incluye en la descarga de la web. `public/guildtrace.png` conserva una copia de
512 píxeles para enlaces compartidos anteriormente.

Para regenerar las imágenes con ImageMagick 7, ejecuta
`bash scripts/optimize-brand.sh` y actualiza las referencias de `src/App.tsx` e
`index.html` con las rutas de `design/brand-assets.json`. Las imágenes resultantes
ya están guardadas en Git; ImageMagick no es necesario para instalar o compilar.

DM Sans y Manrope se sirven localmente en WOFF2 con `font-display: swap`. Sus
licencias SIL OFL están en `public/licenses/` y las fuentes originales de descarga
quedan registradas en `design/font-assets.json`.

Los archivos con versión en `/assets`, `/brand` y `/fonts` se guardan en caché
por un año. Al cambiar su contenido, cambia también su nombre. El HTML conserva
la revalidación habitual de Vercel para recibir las nuevas versiones.
