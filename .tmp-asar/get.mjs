import fs from 'node:fs';
import path from 'node:path';
import { openAsar, walk, readEntry } from './asar.mjs';

const asar = 'D:\\softwares\\DeepSeek Harness\\resources\\app.asar';
const a = openAsar(asar);
const files = walk(a.header, '', []);
const re = new RegExp(process.argv[2], 'i');
const outDir = process.argv[3] ?? '.tmp-asar\\out';
for (const f of files) {
  if (!re.test(f.path)) continue;
  const dest = path.join(outDir, f.path.replace(/^\//, '').replace(/[:*?"<>|]/g, '_'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (f.unpacked) {
    const src = path.join('D:\\softwares\\DeepSeek Harness\\resources\\app.asar.unpacked', f.path.replace(/^\//, ''));
    fs.copyFileSync(src, dest);
  } else {
    fs.writeFileSync(dest, readEntry(a, f));
  }
  console.log(dest);
}
