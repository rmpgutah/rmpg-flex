// Build vision-LoRA SFT data from confirmed dossier captures.
// In:  training/data-alpr/packages.json  — [{ image, target:{plate,state,make,model,year,color,type} }]
// Out: training/dist-alpr/{train,val}.jsonl
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTRUCTION = 'Read the license plate and identify the vehicle. Respond ONLY with JSON: {"plate","state","make","model","year","color","type"}.';

export interface AlprExample { image: string; target: Record<string, string>; }

export function toChatRow(ex: AlprExample) {
  return {
    messages: [
      { role: 'user', content: [{ type: 'image', image: ex.image }, { type: 'text', text: INSTRUCTION }] },
      { role: 'assistant', content: JSON.stringify(ex.target) },
    ],
  };
}

export function isVal(imagePath: string): boolean {
  let h = 0; for (const ch of imagePath) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % 5 === 0;
}

function main() {
  const inPath = join(HERE, 'data-alpr', 'packages.json');
  if (!existsSync(inPath)) { console.error('No packages.json — export confirmed captures first.'); process.exit(1); }
  const examples: AlprExample[] = JSON.parse(readFileSync(inPath, 'utf8'));
  const outDir = join(HERE, 'dist-alpr'); mkdirSync(outDir, { recursive: true });
  const train: string[] = []; const val: string[] = [];
  for (const ex of examples) (isVal(ex.image) ? val : train).push(JSON.stringify(toChatRow(ex)));
  writeFileSync(join(outDir, 'train.jsonl'), train.join('\n'));
  writeFileSync(join(outDir, 'val.jsonl'), val.join('\n'));
  console.log(`Wrote ${train.length} train / ${val.length} val rows.`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
