let ctx = null;
const buffers = {};
const queue = [];

function _flush() {
  if (ctx?.state !== 'running') return;
  queue.forEach(fn => fn());
  queue.length = 0;
}

function _resume() {
  if (!ctx || ctx.state === 'running') return;
  ctx.resume();
}

export function init() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  // Drain queue whenever context starts running
  ctx.addEventListener('statechange', _flush);

  // Resume on any user gesture — NOT once:true so Safari re-suspends are handled
  ['pointerdown', 'touchstart', 'keydown'].forEach(e =>
    document.addEventListener(e, _resume)
  );

  // Resume when tab regains visibility (Safari suspends on background)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _resume();
  });
}

export async function loadFile(name, url) {
  try {
    const res = await fetch(url);
    const arrayBuf = await res.arrayBuffer();
    buffers[name] = await ctx.decodeAudioData(arrayBuf);
  } catch (e) {}
}

export function play(name, { loop = false, volume = 1 } = {}) {
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

  if (!ctx) return;
  if (ctx.state === 'running') return run();
  queue.push(run);
  _resume();
}

export function tone(freq, duration, type = 'sine', volume = 0.3) {
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
  if (!ctx) return;
  if (ctx.state === 'running') return run();
  queue.push(run);
  _resume();
}
