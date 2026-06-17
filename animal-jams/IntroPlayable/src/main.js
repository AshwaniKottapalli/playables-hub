import { Game } from './game.js';

const app    = document.getElementById('app');
const canvas = document.getElementById('gameCanvas');

let _game = null;

function resize() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isLandscape = vw > vh;

  const cw = isLandscape ? 1280 : 720;
  const ch = isLandscape ? 720  : 1280;

  // COVER: fill the viewport in the dominant dimension, allow the other to overflow.
  // body { overflow: hidden } clips the overflow — no bars ever.
  const w = isLandscape ? vw        : vh * cw / ch;
  const h = isLandscape ? vw * ch / cw : vh;

  app.style.width   = `${w}px`;
  app.style.height  = `${h}px`;
  app.style.left    = `${(vw - w) / 2}px`;
  app.style.top     = `${(vh - h) / 2}px`;

  canvas.width        = cw;
  canvas.height       = ch;
  canvas.style.width  = `${w}px`;
  canvas.style.height = `${h}px`;

  _game?.setOrientation(isLandscape);
}

resize();
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(document.body);

function startGame() {
  _game = new Game(app);
  _game.start();
}

// ── MRAID v2.0 ───────────────────────────────────────────────────────────────
window.mraidOpen = function(url) {
  if (typeof mraid !== 'undefined') {
    mraid.open(url);
  } else {
    window.open(url, '_blank');
  }
};

if (typeof mraid !== 'undefined') {
  if (mraid.getState() === 'loading') {
    mraid.addEventListener('ready', () => { resize(); startGame(); });
  } else {
    resize();
    startGame();
  }
} else {
  startGame();
}
