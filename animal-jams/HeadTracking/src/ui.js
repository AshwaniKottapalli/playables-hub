export function buildLoadingScreen() {
  const el = div('loading-screen');
  el.innerHTML = `
    <img src="assets/ui/logotype.png" class="loading-logo" alt="Animal Jam" />
    <div class="loading-bar-wrap"><div class="loading-bar" id="loadingBar"></div></div>
    <div class="loading-text">Jamaa awaits...</div>
  `;
  return el;
}

export function setLoadingProgress(pct) {
  const bar = document.getElementById('loadingBar');
  if (bar) bar.style.width = `${Math.round(pct * 100)}%`;
}

export function buildBoxRevealOverlay(onSkip) {
  const el = div('box-reveal-overlay');
  el.innerHTML = `
    <div class="adopt-label">Adopt a Pet!</div>
    <div class="skip-hint">Tap to skip ›</div>
  `;
  // Only skip-hint intercepts — avoids double-firing with canvas pointerdown
  el.querySelector('.skip-hint').addEventListener('pointerdown', e => {
    e.stopPropagation();
    onSkip();
  });
  return el;
}

export function buildMinigameOverlay() {
  const el = div('minigame-screen');
  el.innerHTML = `
    <div class="minigame-discover">Discover more games inside!</div>
    <div class="minigame-dots">
      <span class="dot active"></span>
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
  `;
  setTimeout(() => {
    const d = el.querySelector('.minigame-discover');
    if (d) d.classList.add('visible');
  }, 1000);
  return el;
}

function div(cls) {
  const el = document.createElement('div');
  el.className = cls;
  return el;
}
