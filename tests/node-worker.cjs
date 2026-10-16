// A Worker-like wrapper around the vendored engine run by Node (stdin/stdout UCI), for integration tests.
const { spawn } = require('child_process');
const path = require('path');
const ENGINE = path.join(__dirname, '..', 'vendor', 'stockfish-19-lite-single.js');

function nodeWorker() {
  const child = spawn(process.execPath, [ENGINE], { stdio: ['pipe', 'pipe', 'inherit'], detached: true });
  const w = { onmessage: null, onerror: null };
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line && w.onmessage) w.onmessage({ data: line }); }
  });
  child.on('error', (e) => w.onerror && w.onerror(e));
  w.postMessage = (s) => child.stdin.write(s + '\n');
  w.terminate = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {} };
  return w;
}
module.exports = { nodeWorker };
