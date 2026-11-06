# HOZONANEGRA

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

Actualmente lint detecta una función `deleteEntry` sin uso en `src/App.tsx`.

## Despliegue

El proyecto de Vercel está conectado al repositorio de GitHub. Los cambios de la rama
de producción activan el despliegue automático. Configura en Vercel las mismas
variables de Supabase antes de compilar.

Configuración de compilación: `npm run build`. Directorio de salida: `dist`.
