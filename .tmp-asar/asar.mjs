import fs from 'node:fs';

export function openAsar(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const sizeBufSize = head.readUInt32LE(4);
  const jsonSize = head.readUInt32LE(12);
  const jsonBuf = Buffer.alloc(jsonSize);
  fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
  const header = JSON.parse(jsonBuf.toString('utf8').replace(/\0+$/, ''));
  const base = 8 + sizeBufSize;
  return { fd, header, base };
}

export function walk(node, prefix, out) {
  for (const [name, meta] of Object.entries(node.files ?? {})) {
    const p = prefix + '/' + name;
    if (meta.files) walk(meta, p, out);
    else out.push({ path: p, offset: Number(meta.offset), size: meta.size, unpacked: !!meta.unpacked });
  }
  return out;
}

export function readEntry(a, e) {
  const buf = Buffer.alloc(e.size);
  fs.readSync(a.fd, buf, 0, e.size, a.base + e.offset);
  return buf;
}

if (process.argv[1]?.endsWith('asar.mjs') && process.argv[2]) {
  const a = openAsar(process.argv[2]);
  const files = walk(a.header, '', []);
  if (process.argv[3] === '--list') {
    console.log(files.length);
    for (const f of files) console.log(f.size.toString().padStart(9), f.path);
  }
}
