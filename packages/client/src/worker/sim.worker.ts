// Runs the simulation off the main thread, paced by real time.
import { ticksDue } from './clock.ts';
import { SimHost } from './host.ts';
import { SPEEDS, type FromWorker, type SpeedSetting, type ToWorker } from './protocol.ts';

// The client compiles against the DOM lib, so describe just the worker scope we use.
const scope = self as unknown as {
  postMessage(msg: FromWorker): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

const FRAME_MS = 50;
let host: SimHost | null = null;
let speed: SpeedSetting = 0;
let carry = 0;
let last = performance.now();
let dirty = false;

const post = (msg: FromWorker) => scope.postMessage(msg);

function publish() {
  if (host) post({ type: 'snapshot', summary: host.snapshot(), speed });
  dirty = false;
}

scope.onmessage = (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init':
        host = new SimHost(msg.scenario);
        post({ type: 'ready', scenario: host.info });
        publish();
        return;
      case 'command': {
        if (!host) return;
        const reason = host.command(msg.command);
        if (reason) post({ type: 'rejected', command: msg.command, reason: reason.replace(/^\w+: /, '') });
        dirty = true;
        return;
      }
      case 'speed':
        speed = msg.speed;
        carry = 0;
        dirty = true;
        return;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

setInterval(() => {
  const now = performance.now();
  const elapsed = now - last;
  last = now;
  if (!host) return;
  const due = ticksDue(carry, elapsed, SPEEDS[speed]);
  carry = due.carry;
  if (due.ticks > 0 && host.advance(due.ticks) > 0) dirty = true;
  if (host.finished && speed !== 0) {
    speed = 0;
    dirty = true;
  }
  if (dirty) publish();
}, FRAME_MS);
