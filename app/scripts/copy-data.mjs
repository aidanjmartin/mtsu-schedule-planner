// Copies the repository's data/ folder into app/public/data so the built site can load it.
// It copies catalogs, offerings.json, and the parsed schedule files. It skips data/schedule/raw
// (the saved web pages), which the site never reads.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '..', '..', 'data');
const target = path.resolve(here, '..', 'public', 'data');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

let count = 0;
function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  count += 1;
}

for (const file of fs.readdirSync(path.join(source, 'catalogs'))) {
  if (file.endsWith('.json')) copy(path.join(source, 'catalogs', file), path.join(target, 'catalogs', file));
}
if (fs.existsSync(path.join(source, 'offerings.json'))) {
  copy(path.join(source, 'offerings.json'), path.join(target, 'offerings.json'));
}
const scheduleDir = path.join(source, 'schedule');
if (fs.existsSync(scheduleDir)) {
  for (const file of fs.readdirSync(scheduleDir)) {
    if (file.endsWith('.json')) copy(path.join(scheduleDir, file), path.join(target, 'schedule', file));
  }
}
console.log(`Copied ${count} data files to ${path.relative(process.cwd(), target) || target}.`);
