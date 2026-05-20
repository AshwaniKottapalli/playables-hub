let ctx = null;
const buffers = {};
const queue = [];
let unlocked = false;

export function init() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const unlock = () => {
    if (unlocked) return;
    ctx.resume().then(() => {
      unlocked = true;
      queue.forEach(n => n());
      queue.length = 0;
    });
  };
  ['pointerdown', 'touchstart', 'keydown'].forEach(e =>
    document.addEventListener(e, unlock, { once: true })
  );
}

export async function loadFile(name, url) {
  const res = await fetch(url);
  const arrayBuf = await res.arrayBuffer();
  buffers[name] = await ctx.decodeAudioData(arrayBuf);
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
  if (ctx.state === 'running') return run();
  queue.push(run);
}
