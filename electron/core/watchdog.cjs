'use strict';
/**
 * Wächter (Mac/Linux): läuft neben SlimManager und merkt sich eingefrorene Prozesse und den Hintergrund-Modus.
 * Endet SlimManager – egal ob normal oder durch Absturz –, schließt sich unsere Eingabe:
 * dann wird alles aufgetaut und zurückgesetzt. So bleibt nie ein Programm "hängen".
 *   Zeilen: "S <pid>" eingefroren · "R <pid>" aufgetaut · "B <pid>" Hintergrund-Modus · "X <pid>" Hintergrund-Modus aus
 */
const { execFileSync } = require('node:child_process');

const frozen = new Set();
const bg = new Set();
let buf = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const [cmd, arg] = buf.slice(0, i).trim().split(' ');
    buf = buf.slice(i + 1);
    const pid = Number(arg);
    if (!Number.isInteger(pid) || pid <= 4) continue;
    if (cmd === 'S') frozen.add(pid);
    else if (cmd === 'R') frozen.delete(pid);
    else if (cmd === 'B') bg.add(pid);
    else if (cmd === 'X') bg.delete(pid);
  }
});

function restore() {
  for (const pid of frozen) {
    try {
      process.kill(pid, 'SIGCONT');
    } catch {
      /* schon weg */
    }
  }
  for (const pid of bg) {
    try {
      execFileSync('/usr/sbin/taskpolicy', ['-B', '-p', String(pid)], { stdio: 'ignore', timeout: 3000 });
    } catch {
      /* egal */
    }
  }
  process.exit(0);
}
process.stdin.on('end', restore);
process.stdin.on('close', restore);
process.on('SIGTERM', restore);
process.on('SIGINT', restore);
