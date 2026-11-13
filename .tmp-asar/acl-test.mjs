import { t as AclSandbox, a as workspaceWriteSid, i as tempWriteSid } from './out/dsh/node_modules/@deepseek-ai/dsh-sandbox-windows-acl/lib/types-DFdfvhLN.js';
import fs from 'node:fs';

const ws = process.cwd();
const tmp = process.env.TEMP + '\\dsh-bench';
fs.mkdirSync(tmp, { recursive: true });

const s = new AclSandbox({
  writableDirs: [ws],
  tempDir: tmp,
  mode: 'workspace-write',
  writeSid: workspaceWriteSid(ws),
  tempWriteSid: tempWriteSid(tmp),
  manageDacls: true,
});
try {
  await s.init();
  console.log('init ok');
  const child = s.spawn({ command: 'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '"HELLO"; exit 0'], stdio: 'inherit' });
  console.log('exit', (await child.wait()).exitCode);
  s.dispose();
} catch (e) {
  const show = (x) => console.log('ERR:', x?.constructor?.name, '|', x?.message, '|', JSON.stringify(x?.win32 ?? x?.stack?.split('\n')[1] ?? ''));
  if (e instanceof AggregateError) { show(e); for (const inner of e.errors) show(inner); }
  else show(e);
}
