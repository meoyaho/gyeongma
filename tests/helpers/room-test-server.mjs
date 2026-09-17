import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

// Run the real HTTP/WebSocket handlers with external name/database services
// replaced only in this child test process. Never reads/writes production rooms.
export async function startRoomTestServer() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const serverUrl = new URL('../../server/index.js', import.meta.url).href;
  const mocks = {
    './name-check.js': 'export async function checkName() { return { ok: true }; }',
    './room-store.js': 'export async function saveRoom() {} export async function deleteRoom() {}',
    './kra-rankings.js': 'export async function getRankedAiHorseNames() { return Array(7).fill("구름콩콩이"); }'
  };
  const loader = `export async function resolve(specifier, context, next) {
    const mocks = ${JSON.stringify(mocks)};
    if (context.parentURL === ${JSON.stringify(serverUrl)} && mocks[specifier])
      return { url: 'data:text/javascript,' + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  }`;
  const boot = `import { register } from 'node:module'; register(${JSON.stringify('data:text/javascript,' + encodeURIComponent(loader))}, ${JSON.stringify(serverUrl)});`;
  const child = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(boot), 'server/index.js', '--production'], {
    cwd: root, env: { ...process.env, PORT: String(port), VITE_SERVER_ORIGIN: `http://127.0.0.1:${port}`, VITE_BASE_PATH: '/' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    try { await exited; } finally { clearTimeout(timer); }
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test server startup timed out')), 15000);
      const finish = callback => value => { clearTimeout(timer); callback(value); };
      child.once('error', finish(reject));
      child.once('exit', finish(() => reject(new Error('Test server exited before startup'))));
      child.stdout.on('data', data => { if (String(data).includes(`http://localhost:${port}`)) finish(resolve)(); });
      child.stderr.on('data', () => {});
    });
    return { origin: `http://127.0.0.1:${port}`, close };
  } catch (error) { await close(); throw error; }
}
