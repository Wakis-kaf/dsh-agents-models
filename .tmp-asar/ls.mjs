import { openAsar, walk, readEntry } from './asar.mjs';

const asar = 'D:\\softwares\\DeepSeek Harness\\resources\\app.asar';
const a = openAsar(asar);
const files = walk(a.header, '', []);
const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
for (const f of files) if (only && only.test(f.path)) console.log(f.size.toString().padStart(9), f.path);
