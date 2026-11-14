import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=new URL('..',import.meta.url);
const files=fs.readdirSync(root).filter(x=>x.endsWith('.Rmd'));
for(const file of files){
  const text=fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
  assert.doesNotMatch(text,/Bloque\s+\d+\s+de\s+11\s+·\s+MIG-/i,`${file}: no debe mostrar bloques MIG`);
  assert.doesNotMatch(text,/id="mig\d+-panel"/i,`${file}: no debe conservar paneles MIG operativos`);
  assert.doesNotMatch(text,/src="js\/mig\d+\.js/i,`${file}: no debe cargar scripts MIG desde la interfaz`);
}
console.log(`migration-ui-removed: OK · ${files.length} pantallas revisadas`);
