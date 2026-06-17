import { Game } from './game.js';

const app    = document.getElementById('app');
const canvas = document.getElementById('gameCanvas');

function resize() {
  const ww = window.innerWidth;
  const wh = window.innerHeight;
  const aspect = 9 / 16;

  // Always fill the full viewport HEIGHT so there are no black bars on mobile.
  // The game may be slightly wider than the screen on very tall/narrow phones
  // (e.g. iPhone 14 = 390×844, aspect 0.46), in which case it overflows
  // a few px left/right — body overflow:hidden hides it cleanly.
  const h = wh;
  const w = wh * aspect;

  app.style.width   = `${w}px`;
  app.style.height  = `${h}px`;
  app.style.left    = `${(ww - w) / 2}px`;
  app.style.top     = '0px'; // always flush to top — no top gap

  canvas.width        = 720;
  canvas.height       = 1280;
  canvas.style.width  = `${w}px`;
  canvas.style.height = `${h}px`;
}

resize();
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(document.body);

// Don't block on font load — canvas falls back to Impact until font is ready
const game = new Game(app);
game.start();
