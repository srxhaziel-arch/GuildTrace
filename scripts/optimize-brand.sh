#!/usr/bin/env bash
# Optimización de formato y tamaño; conserva el diseño del logo original.
set -euo pipefail
cd "$(dirname "$0")/.."
asset_tmp=$(mktemp -d)
trap 'rm -rf "$asset_tmp"' EXIT
mkdir -p public/brand
for asset_size in 64 128; do
  magick design/guildtrace-master.png -resize "${asset_size}x${asset_size}" -strip -define webp:lossless=true -define webp:method=6 "$asset_tmp/logo-${asset_size}.webp"
done
magick design/guildtrace-master.png -resize 48x48 -strip "$asset_tmp/favicon.png"
magick design/guildtrace-master.png -resize 512x512 -strip "$asset_tmp/social.png"
node --input-type=module - "$asset_tmp" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = process.argv[2];
const files = {};
for (const [key, source] of Object.entries({ logo64: 'logo-64.webp', logo128: 'logo-128.webp', favicon: 'favicon.png', social: 'social.png' })) {
  const data = readFileSync(`${root}/${source}`);
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 10);
  const dot = source.lastIndexOf('.');
  const filename = `guildtrace-${source.slice(0, dot)}.${hash}${source.slice(dot)}`;
  writeFileSync(`public/brand/${filename}`, data);
  files[key] = `/brand/${filename}`;
  console.log(key, data.length, 'bytes');
}
// Compatibilidad con las tarjetas compartidas antes de esta optimización.
writeFileSync('public/guildtrace.png', readFileSync(`${root}/social.png`));
writeFileSync('design/brand-assets.json', JSON.stringify(files, null, 2) + '\n');
JS
