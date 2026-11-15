import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const exporterPath = path.join(root, 'js', 'audit-export.js');
const rulesPath = path.join(root, 'firebase', 'firestore.rules');

const exporter = fs.readFileSync(exporterPath, 'utf8');
const rules = fs.readFileSync(rulesPath, 'utf8');

const listMatch = exporter.match(/const\s+COLLECTIONS\s*=\s*\[([\s\S]*?)\];/);
assert.ok(listMatch, 'No se encontró const COLLECTIONS en audit-export.js');
const exported = [...listMatch[1].matchAll(/["']([^"']+)["']/g)].map(m => m[1]);

// Las colecciones de usuario protegidas por reglas usan el patrón match /<coleccion>/{id}.
// El root /users/{userId} y los wildcards no entran en este conjunto.
const ruled = [...rules.matchAll(/match\s+\/([A-Za-z][A-Za-z0-9_]*)\/\{id\}/g)].map(m => m[1]);

assert.equal(new Set(exported).size, exported.length, 'COLLECTIONS contiene duplicados');
assert.equal(new Set(ruled).size, ruled.length, 'Las reglas contienen matches {id} duplicados inesperados');
assert.deepEqual([...exported].sort(), [...ruled].sort(),
  'El exportador RAW y las colecciones {id} de firestore.rules están desalineados');
assert.equal(exported.length, 26, 'El contrato actual espera 26 colecciones de usuario');
assert.match(exporter, /const\s+SOURCE_APP_VERSION\s*=\s*["']V1\.0\.85["']/);
assert.match(exporter, /const\s+EXPORTER_VERSION\s*=\s*["']1\.1\.0["']/);

console.log(`Audit export coverage OK: ${exported.length} collections; version V1.0.85; exporter 1.1.0`);
