import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(resolve(root, 'node_modules/tesseract.js/package.json'), 'utf8'));
const target = resolve(root, `public/ocr/tesseract-${version}`);
await mkdir(resolve(target, 'core'), { recursive: true });
await copyFile(resolve(root, 'node_modules/tesseract.js/dist/worker.min.js'), resolve(target, 'worker.min.js'));
await copyFile(resolve(root, 'node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt'), resolve(target, 'worker.min.js.LICENSE.txt'));
for (const engine of ['lstm', 'simd-lstm', 'relaxedsimd-lstm']) {
  const file = `tesseract-core-${engine}.wasm.js`;
  await copyFile(resolve(root, 'node_modules/tesseract.js-core', file), resolve(target, 'core', file));
}
console.log(`OCR local preparado: Tesseract ${version}`);
