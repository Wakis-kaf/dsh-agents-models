import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { openAsar, walk, readEntry } from './asar.mjs';

const ASAR = 'D:\\softwares\\DeepSeek Harness\\resources\\app.asar';
const UNPACKED = 'D:\\softwares\\DeepSeek Harness\\resources\\app.asar.unpacked';
const OUT = '.tmp-asar\\out';
const a = openAsar(ASAR);
const files = walk(a.header, '', []);
const byPath = new Map(files.map((f) => [f.path, f]));

function extract(re) {
  let n = 0;
  for (const f of files) {
    if (!re.test(f.path)) continue;
    const dest = path.join(OUT, f.path.replace(/^\//, ''));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (f.unpacked) fs.copyFileSync(path.join(UNPACKED, f.path.replace(/^\//, '')), dest);
    else fs.writeFileSync(dest, readEntry(a, f));
    n++;
  }
  return n;
}

const runner = path.resolve(OUT, 'dsh/node_modules/@deepseek-ai/dsh-sandbox-windows-acl/lib/runner.js');
const args = [
  runner, '--workspace', process.cwd(), '--temp', process.env.TEMP + '\\dsh-bench',
  '--mode', 'workspace-write', '--',
  'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', process.argv[2] ?? '"OK"; exit 0',
];
fs.mkdirSync(process.env.TEMP + '\\dsh-bench', { recursive: true });

for (let i = 0; i < 25; i++) {
  try {
    const errFd = fs.openSync('.tmp-asar/stderr.txt', 'w');
    const outFd = fs.openSync('.tmp-asar/stdout.txt', 'w');
    const t0 = performance.now();
    execFileSync(process.execPath, args, { stdio: ['ignore', outFd, errFd] });
    const dt = performance.now() - t0;
    fs.closeSync(outFd); fs.closeSync(errFd);
    console.log(`elapsed=${dt.toFixed(0)}ms out=${JSON.stringify(fs.readFileSync('.tmp-asar/stdout.txt', 'utf8').trim())}`);
    break;
  } catch (e) {
    const msg = fs.existsSync('.tmp-asar/stderr.txt') ? fs.readFileSync('.tmp-asar/stderr.txt', 'utf8') : String(e.message);
    const m = msg.match(/Cannot find package '([^']+)'/);
    if (!m) { console.log('FAIL:\n' + msg.slice(0, 800)); break; }
    const pkg = m[1];
    const re = new RegExp(`^/dsh/node_modules/${pkg.replace(/[/\\^$.*+?()[\]{}|]/g, '\\$&')}/(package\\.json|lib/|dist/|index)`, 'i');
    const n = extract(re);
    console.log(`+ ${pkg}: ${n} files`);
    if (n === 0) { console.log('no files for ' + pkg); break; }
  }
}
