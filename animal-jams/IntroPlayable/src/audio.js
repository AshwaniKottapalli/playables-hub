let ctx = null;
const buffers = {};
const queue = [];

function _flush() {
  if (ctx?.state !== 'running') return;
  const pending = queue.splice(0);
  pending.forEach(fn => fn());
}

async function _resume() {
  if (!ctx || ctx.state === 'running') return;
  try {
    await ctx.resume();
    _flush(); // explicit flush — statechange not reliable on all iOS versions
  } catch (_) {}
}

export function init() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  // Drain queue whenever context transitions to running
  ctx.addEventListener('statechange', _flush);

  // Resume on any user gesture — persistent (not once) so iOS re-suspends are handled
  ['pointerdown', 'touchstart', 'keydown'].forEach(e =>
    document.addEventListener(e, _resume)
  );

  // Suspend when hidden, resume when visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      ctx?.suspend();
    } else {
      _resume();
    }
  });
}

export async function loadFile(name, url) {
  try {
    const res = await fetch(url);
    const arrayBuf = await res.arrayBuffer();
    buffers[name] = await ctx.decodeAudioData(arrayBuf);
  } catch (_) {}
}

export function play(name, { loop = false, volume = 1 } = {}) {
  if (!ctx) return;

  const run = () => {
    const buf = buffers[name];
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    return src;
  };

  if (ctx.state === 'running') {
    run();
  } else {
    queue.push(run);
    _resume();
  }
}

export function tone(freq, duration, type = 'sine', volume = 0.3) {
  if (!ctx) return;

  const run = () => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  };

  if (ctx.state === 'running') {
    run();
  } else {
    queue.push(run);
    _resume();
  }
}
