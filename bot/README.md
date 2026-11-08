# Bot de GuildTrace

Consultas públicas de solo lectura con `/mapa nombre` y `/gremio nombre`, sugerencias
de nombres y botones Anterior/Siguiente. Los nombres deben corresponder a los datos
guardados; si no hay coincidencia exacta, se ofrecen sugerencias.

Funciona mediante interacciones HTTP en Vercel, junto con la web. No necesita un
proceso conectado permanentemente a Discord ni el permiso Message Content Intent.
La lista se consulta por páginas para no cortar los resultados de Supabase y se
almacena en caché durante 10 segundos como máximo. Cada mapa conserva el orden de
sus gremios. Los botones de paginación son para quien hizo la consulta; cualquier
otra persona puede iniciar la suya.

## 1. Crear la aplicación de Discord

1. Abre <https://discord.com/developers/applications> y pulsa **New Application**.
2. Llámala **GuildTrace**. Puedes usar `public/guildtrace.png` como icono.
3. En **General Information**, copia **Application ID** y **Public Key**. Son públicos.
4. En **Bot**, crea/restablece el token cuando vayas a registrar los comandos.
   Guarda el token en una variable segura `DISCORD_BOT_TOKEN`. Nunca lo pegues en
   el chat, en GitHub ni en una variable con prefijo `VITE_`.

## 2. Configurar Vercel

En el proyecto de la web, añade en **Settings → Environment Variables**:

| Variable | Uso |
| --- | --- |
| `DISCORD_PUBLIC_KEY` | Public Key de General Information, 64 caracteres hexadecimales. |
| `VITE_SUPABASE_URL` | URL pública del proyecto Supabase; ya la usa la web. |
| `VITE_SUPABASE_ANON_KEY` | Clave pública anon/publishable; ya la usa la web. |
| `WEBSITE_URL` | Opcional, URL HTTPS de la web si cambia su dirección. |

También se admiten `SUPABASE_URL` y `SUPABASE_ANON_KEY` como alternativas en el
servidor. Nunca se necesita una clave `service_role`.

Despliega nuevamente después de guardar las variables. El token del bot **no se
necesita en Vercel**: las respuestas usan el token temporal de cada interacción.

## 3. Configurar el endpoint

En Discord → **General Information → Interactions Endpoint URL**, guarda:

```
https://hozonanegra.vercel.app/api/discord
```

Esta es la dirección actual de GuildTrace. Si cambias el dominio, actualiza también
el endpoint. Discord envía un PING firmado para verificarlo. El endpoint rechaza
peticiones sin firma o alteradas. Responde 503 mientras falte la clave pública.

## 4. Registrar los comandos e invitarlo

Requisitos del script: Node.js 24 y npm. Desde la raíz del repositorio:

```sh
npm ci
npm run bot:test
npm run bot:register -- --dry-run
```

Para registrar de verdad, configura `DISCORD_APPLICATION_ID` y `DISCORD_BOT_TOKEN`
en el entorno del comando. También puedes usar un `.env.local` ignorado por Git.
No pongas valores de secretos en el historial del terminal. Opcionalmente define
`DISCORD_GUILD_ID` para registrar primero en un único servidor de prueba.

```sh
npm run bot:register
```

En el entorno de Codex, utiliza el proxy heredado con Node.js 24:

```sh
NODE_USE_ENV_PROXY=1 npm run bot:register
```

El script reemplaza los comandos de esta aplicación (o de este servidor de prueba)
por `/mapa` y `/gremio`, y muestra una invitación con los scopes `bot` y
`applications.commands`. Los permisos solicitados son ver canales, enviar mensajes
e insertar enlaces. No necesita Administrador. Los comandos globales pueden tardar
en aparecer. No registres comandos de prueba y globales simultáneamente en el
mismo servidor para evitar duplicados.

## 5. Verificar en Discord

- `/mapa nombre:…`: comprobar gremios y su orden.
- `/gremio nombre:…`: comprobar los mapas y recorrer resultados si hay varias páginas.
- Probar un nombre inexistente y las sugerencias al escribir.
- Comprobar que Abrir en la web lleva a GuildTrace.

Las respuestas del bot no editan ni eliminan datos. Los fallos se comunican sin
mostrar credenciales. Si Supabase no permite leer la tabla con la clave pública,
comprueba las políticas de lectura del proyecto; no expongas una clave privada.

## Pruebas locales

`npm run bot:test` verifica firmas Ed25519, PING, respuestas diferidas, botones,
permisos del solicitante, límites de Discord, errores y paginación de Supabase.
Estas pruebas simulan Discord: no sustituyen la comprobación en un servidor real.
