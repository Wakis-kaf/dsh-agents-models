import { openAsar, walk, readEntry } from './asar.mjs';

const asar = 'D:\\softwares\\DeepSeek Harness\\resources\\app.asar';
const a = openAsar(asar);
const files = walk(a.header, '', []);
const needle = new RegExp(process.argv[2]);
const pathFilter = process.argv[3] ? new RegExp(process.argv[3], 'i') : /\.(js|mjs|cjs|json|yml|md)$/i;
for (const f of files) {
  if (f.unpacked || f.size > 3_000_000) continue;
  if (!pathFilter.test(f.path)) continue;
  const text = readEntry(a, f).toString('utf8');
  if (!needle.test(text)) continue;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (needle.test(line)) console.log(`${f.path}:${i + 1}: ${line.trim().slice(0, 300)}`);
  });
}
