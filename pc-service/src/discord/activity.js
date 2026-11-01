import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

// Mesure l'activité du joueur (manette, clavier, souris) pour la détection de
// clips. Vie privée : seuls des COMPTEURS par seconde sont produits (nombre de
// touches changeant d'état, distance de la souris, changements de la manette) —
// jamais quelles touches ni ce qui est tapé, et rien n'est écrit sur disque.
// Windows uniquement : un PowerShell persistant interroge user32/XInput.
const SCRIPT = `
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class SSIn {
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int k);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out PT p);
  [StructLayout(LayoutKind.Sequential)] struct PT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct XS { public uint pkt; public ushort btn; public byte lt, rt; public short lx, ly, rx, ry; }
  [DllImport("xinput1_4.dll")] static extern uint XInputGetState(uint i, out XS s);
  static bool[] down = new bool[256]; static int mx = -1, my = -1; static XS pad; static bool padOk;
  public static int[] Poll() {
    int keys = 0, mouse = 0, padN = 0;
    for (int k = 1; k < 255; k++) {
      bool d = (GetAsyncKeyState(k) & 0x8000) != 0;
      if (d && !down[k]) keys++;
      down[k] = d;
    }
    PT p; if (GetCursorPos(out p)) { if (mx >= 0) mouse = Math.Abs(p.X - mx) + Math.Abs(p.Y - my); mx = p.X; my = p.Y; }
    for (uint i = 0; i < 4; i++) {
      XS s; try { if (XInputGetState(i, out s) != 0) continue; } catch { break; }
      if (padOk) {
        padN += Convert.ToString(s.btn ^ pad.btn, 2).Replace("0", "").Length;
        padN += (Math.Abs(s.lx - pad.lx) + Math.Abs(s.ly - pad.ly) + Math.Abs(s.rx - pad.rx) + Math.Abs(s.ry - pad.ry)) > 12000 ? 1 : 0;
        padN += (Math.Abs(s.lt - pad.lt) + Math.Abs(s.rt - pad.rt)) > 60 ? 1 : 0;
      }
      pad = s; padOk = true; break;
    }
    return new int[] { keys, mouse, padN };
  }
}
'@
$k = 0; $m = 0; $p = 0; $n = 0
while ($true) {
  $r = [SSIn]::Poll(); $k += $r[0]; $m += $r[1]; $p += $r[2]; $n++
  if ($n -ge 10) { [Console]::Out.WriteLine("A $k $m $p"); [Console]::Out.Flush(); $k = 0; $m = 0; $p = 0; $n = 0 }
  Start-Sleep -Milliseconds 100
}
`;

export function parseActivityLine(line) {
  const m = /^A (\d+) (\d+) (\d+)$/.exec(String(line).trim());
  return m ? { keys: Number(m[1]), mouse: Number(m[2]), pad: Number(m[3]) } : null;
}

// Émet « sample » ({ keys, mouse, pad }) une fois par seconde tant qu'il tourne.
export class ActivityMonitor extends EventEmitter {
  constructor({ log = () => {} } = {}) {
    super();
    this.log = log;
    this.child = null;
    this.latest = null;
  }

  get running() {
    return Boolean(this.child);
  }

  start() {
    if (this.child || process.platform !== 'win32') return;
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let pending = '';
    child.stdout.on('data', (chunk) => {
      pending += chunk;
      let i;
      while ((i = pending.indexOf('\n')) >= 0) {
        const sample = parseActivityLine(pending.slice(0, i));
        pending = pending.slice(i + 1);
        if (sample) { this.latest = sample; this.emit('sample', sample); }
      }
    });
    child.on('exit', () => {
      if (this.child === child) { this.child = null; this.latest = null; }
    });
    child.on('error', (err) => { this.log(`(clips) mesure d'activité indisponible : ${err.message}`); this.child = null; });
    this.child = child;
  }

  stop() {
    this.child?.kill();
    this.child = null;
    this.latest = null;
  }
}
