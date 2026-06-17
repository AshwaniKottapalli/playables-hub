import { CONFIG } from './config.js';
import { loadAtlas, getFrame, getFramesByPrefix, drawFrame } from './atlas.js';
import { PetRenderer } from './renderer.js';
import { ParticleSystem } from './particles.js';
import * as Audio from './audio.js';
import { tween, updateTweens, Ease, wait } from './tween.js';
import { buildLoadingScreen, setLoadingProgress, buildBoxRevealOverlay, buildMinigameOverlay } from './ui.js';

const STATE = {
  LOADING:   'loading',
  BOX_REVEAL:'box_reveal',
  SELECT:    'select',
  ZOOM:      'zoom',
  COLOR_PICK:'color_pick',
  ACC_PICK:  'acc_pick',
  MINIGAME:  'minigame',
  CTA:       'cta',
};

const CW = 720;
const CH = 1280;
const B  = CONFIG.brand;

// Dock floor Y — where the pet's feet sit in the canvas
const FLOOR_Y = 800;

// Arc orb positions for the floating color picker above the pet
const ARC_ORB_X = [180, 360, 540];
const ARC_ORB_Y = [400, 315, 400]; // final resting positions (above pet head)

// Rug slides up from below when pet is selected; bottom anchored just below FLOOR_Y
const RUG_FINAL_Y = FLOOR_Y - 55; // top of rug (rug height ~110px, bottom at FLOOR_Y + 55)

export class Game {
  constructor(app) {
    this.app      = app;
    this.state    = STATE.LOADING;
    this.petIdx   = 0;
    this.petId    = null;
    this.colorIdx = 0;
    this.accIdx   = null;

    this._canvas   = app.querySelector('#gameCanvas');
    this._ctx      = this._canvas.getContext('2d');
    this._uiRoot   = app.querySelector('#ui');
    this._renderer = new PetRenderer(this._canvas);
    this._particles= new ParticleSystem(this._canvas);

    this._selectRenderers = [];
    this._last  = null;
    this._bgImg = null;
    this._bgCtaImg = null;
    this._logoImg  = null;

    // Shared animated properties (tweened)
    this._vignetteAlpha  = 0;
    this._overlayAlpha   = 0;
    this._rugY           = CH + 200;
    this._bgZoom         = 1.0;
    this._bgMusicStarted = false;
    this._caption        = { text: '', alpha: 0 }; // story arc captions
    this._petFlash       = 0; // white bloom on selection confirm
    this._ctaElapsed     = 0; // for CTA button pulse // zooms in when pet is selected (1.0 = normal, >1 = zoomed)

    // Per-state sub-state
    this._box       = null; // BOX_REVEAL state data
    this._color     = { orbScales: [1, 1, 1], selected: 0 };
    this._acc       = { panelScales: [1, 1, 1], selected: -1 };
    this._panelSlide = { y: 0 }; // animated panel Y offset for color/acc pick
    this._cta    = { panelY: CH + 400, leftX: -220, rightX: CW + 220, barsY: -220 };
    this._carousel = { scrollX: 0, swipeStartX: null, swipeDelta: 0, elapsed: 0 };

    // Track which card scrolled past center last (for pet reaction)
    this._lastCardPastCenter = -1;

    this._canvas.addEventListener('pointerdown', e => this._onPointerDown(e));
    this._canvas.addEventListener('pointermove', e => this._onPointerMove(e));
    this._canvas.addEventListener('pointerup',   e => this._onPointerUp(e));
  }

  // ── Story caption ─────────────────────────────────────────────────────────
  _showCaption(text, duration = 1.8) {
    this._caption.text = text;
    this._caption.alpha = 0;
    tween(this._caption, { alpha: 1 }, 0.3, Ease.easeOutCubic);
    wait(duration - 0.6).then(() =>
      tween(this._caption, { alpha: 0 }, 0.5, Ease.easeInCubic));
  }

  // ── Head offset helper ────────────────────────────────────────────────────
  _applyHeadOffsets(petId, variant) {
    const key = `idle-${variant + 1}`;
    const offsets = this._headOffsets?.[petId]?.[key] ?? null;
    this._renderer.setHeadOffsets(offsets);
  }

  // ── Floor-anchored cy ────────────────────────────────────────────────────
  // Returns renderer.cy so the pet's visual feet sit on FLOOR_Y at the given scale.
  _floorCy(scale, targetFloor = FLOOR_Y) {
    const pet = CONFIG.pets.find(p => p.id === this.petId);
    if (!pet) return targetFloor - 200;
    const frames = getFramesByPrefix(pet.atlases, `${this.petId}-idle-1-`);
    if (!frames.length) return targetFloor - 200;
    const fd = getFrame(frames[0].atlas, frames[0].frame);
    if (!fd) return targetFloor - 200;
    const effectiveH = Math.max(fd.sourceSize.w, fd.sourceSize.h);
    return targetFloor - (effectiveH / 2) * scale;
  }

  // ── Coord helper ──────────────────────────────────────────────────────────
  _toCanvas(e) {
    const r = this._canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (CW / r.width),
      y: (e.clientY - r.top)  * (CH / r.height),
    };
  }

  // ── Input handlers ────────────────────────────────────────────────────────
  _onPointerDown(e) {
    const { x, y } = this._toCanvas(e);
    // Start bg music on first interaction anywhere in the ad
    if (!this._bgMusicStarted) {
      this._bgMusicStarted = true;
      Audio.play('bgMusic', { loop: true, volume: 0.22 });
    }
    if (this.state === STATE.BOX_REVEAL) {
      if (this._box?.subPhase === 'OPEN') {
        // Pet tap zones active once pets have landed
        for (let i = 0; i < 3; i++) {
          const cx = this._box.petCxs[i];
          const cy = this._box.petCys[i];
          if (this._box.petAlphas[i] > 0.5 &&
              Math.abs(x - cx) < 120 && Math.abs(y - cy) < 140) {
            Audio.play(`pet-${i + 1}`, { volume: 0.9 });
            this._box.done = true;
            // Scale bounce — avoids click-1 frame variation issues (seal click-1 has 375px range)
            const r = this._selectRenderers[i];
            if (r) tween(r, { scale: 1.7 }, 0.1, Ease.easeOutCubic,
              () => tween(r, { scale: 1.35 }, 0.1, Ease.easeInCubic));
            this._particles.emit(this._box.petCxs[i], this._box.petCys[i] - 40, 10,
              { kind: 'sparkle', color: '#ffe066', speed: 220, size: 14, lifetime: 0.6 });
            setTimeout(() => this._toZoom(i), 230);
            return;
          }
        }
      } else {
        this._skipBoxReveal();
      }
      return;
    } else if (this.state === STATE.SELECT) {
      this._handleSelectTap(x, y);
    } else if (this.state === STATE.COLOR_PICK) {
      this._handleColorTap(x, y);
    } else if (this.state === STATE.ACC_PICK) {
      this._handleAccTap(x, y);
    } else if (this.state === STATE.MINIGAME) {
      this._carousel.swipeStartX = x;
      this._carousel.swipeDelta  = 0;
    } else if (this.state === STATE.CTA) {
      this._handleCtaTap(x, y);
    }
  }

  _onPointerMove(e) {
    if (this.state !== STATE.MINIGAME) return;
    if (this._carousel.swipeStartX === null) return;
    const { x } = this._toCanvas(e);
    this._carousel.swipeDelta = Math.max(-350, Math.min(350,
      this._carousel.swipeStartX - x));
  }

  _onPointerUp(e) {
    if (this.state !== STATE.MINIGAME) return;
    const delta = this._carousel.swipeDelta;
    this._carousel.swipeStartX = null;
    if (Math.abs(delta) > 30) {
      // Add momentum, rubber-band back
      const target = this._carousel.scrollX + delta * 1.2;
      tween(this._carousel, { scrollX: target }, 0.35, Ease.easeOutCubic, () => {
        this._carousel.swipeDelta = 0;
      });
    }
    tween(this._carousel, { swipeDelta: 0 }, 0.4, Ease.easeOutCubic);
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  async start() {
    Audio.init();
    const atlasNames = [
      'texture-backgrounds-1', 'texture-backgrounds-2',
      'texture-elements', 'texture-custom-elements', 'texture-particles',
      'texture-pet-accessories',
      'texture-pet1-1', 'texture-pet1-2',
      'texture-pet2-1', 'texture-pet2-2',
      'texture-pet3-1', 'texture-pet3-2',
    ];

    this._show(buildLoadingScreen());

    // Load all atlases + images in parallel; update progress bar as each resolves
    const imgAssets = [
      'assets/texture-backgrounds-1.jpeg',
      'assets/texture-backgrounds-2.jpeg',
      'assets/ui/logotype.png',
      'assets/generated/boxSprite_fixed.png',
      ...CONFIG.gameCards.map(c => c.image),
    ];
    const total = atlasNames.length + imgAssets.length;
    let done = 0;
    const tick = () => setLoadingProgress(++done / total);

    const [atlasResults, imgResults] = await Promise.all([
      Promise.all(atlasNames.map(n => loadAtlas(n).then(r => { tick(); return r; }))),
      Promise.all(imgAssets.map(u => loadImg(u).catch(() => null).then(r => { tick(); return r; }))),
    ]);

    [this._bgImg, this._bgCtaImg, this._logoImg, this._boxSpriteImg] = imgResults;
    this._gameImgs = imgResults.slice(4);

    // Load centroid-based head offsets for accessory tracking
    this._headOffsets = await fetch('assets/head-offsets.json').then(r => r.json()).catch(() => null);

    Object.entries(CONFIG.audio).forEach(([n, u]) => Audio.loadFile(n, u).catch(() => {}));
    CONFIG.pets.forEach((p, i) => Audio.loadFile(`pet-${i + 1}`, p.sound).catch(() => {}));

    this._toBoxReveal();
    requestAnimationFrame(ts => this._loop(ts));
  }

  // ── Main loop ─────────────────────────────────────────────────────────────
  _loop(ts) {
    const dt = Math.min((ts - (this._last ?? ts)) / 1000, 0.08);
    this._last = ts;

    updateTweens(dt);

    const ctx = this._ctx;
    ctx.clearRect(0, 0, CW, CH);

    // Background — _bgZoom > 1 creates cinematic zoom-in when pet is selected
    const bg = this._bgImg; // bg1 (tropical dock) for all states
    if (bg) {
      const s  = (CH / 1020) * 1020 * this._bgZoom;
      const bx = -((s - CW) / 2);
      const by = -((s - CH) / 2);  // also center vertically when zoomed
      ctx.drawImage(bg, bx, by, s, s);
    }

    // Rug — drawn on top of background, under pet (visible from ZOOM onwards)
    if (this._rugY < CH + 100) _drawRug(ctx, this._rugY);

    // State-specific rendering
    switch (this.state) {
      case STATE.BOX_REVEAL: this._drawBoxReveal(ctx, dt); break;
      case STATE.SELECT:     this._drawSelect(ctx, dt);    break;
      case STATE.ZOOM:       this._renderer.update(dt); this._renderer.draw(); break;
      case STATE.COLOR_PICK:
        if (this._color) this._color.elapsed += dt;
        this._renderer.update(dt);
        this._drawColorPick(ctx);
        break;
      case STATE.ACC_PICK:
        if (this._acc) this._acc.elapsed = (this._acc.elapsed || 0) + dt;
        this._renderer.update(dt);
        this._drawAccPick(ctx);
        break;
      case STATE.MINIGAME:   this._renderer.update(dt); this._drawMinigame(ctx, dt); break;
      case STATE.CTA:
        this._ctaElapsed = (this._ctaElapsed || 0) + dt;
        this._renderer.update(dt);
        this._drawCTA(ctx, dt);
        break;
    }

    // Vignette overlay (used during ZOOM)
    if (this._vignetteAlpha > 0.01) {
      const vg = ctx.createRadialGradient(CW/2, CH*0.42, 60, CW/2, CH*0.42, CW * 0.9);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, `rgba(0,0,0,${this._vignetteAlpha})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, CW, CH);
    }

    // Story caption overlay (all states)
    if (this._caption.alpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = this._caption.alpha;
      _drawBrandText(ctx, this._caption.text, CW/2, 155, 38, B.darkBrown, '#ffffff');
      ctx.restore();
    }

    // Pet selection flash bloom
    if (this._petFlash > 0.01) {
      const petCx = this._renderer.cx ?? CW/2;
      const petCy = this._renderer.cy ?? CH/2;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this._petFlash * 0.4;
      const grd = ctx.createRadialGradient(petCx, petCy - 80, 0, petCx, petCy - 80, 220);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, CW, CH);
      ctx.restore();
    }

    this._particles.update(dt);
    this._particles.draw();

    requestAnimationFrame(t => this._loop(t));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BOX REVEAL  (sprite-sheet based)
  // ─────────────────────────────────────────────────────────────────────────

  // Sprite sheet: 8 frames × 192×1024px, horizontal strip
  // Box body solid center at frame y≈496 (48% from top)
  // At scale 1.25: frame renders 240×1280 — fills the canvas exactly
  static get _BOX() {
    return {
      FRAMES: 8, FRAME_W: 192, FRAME_H: 1024,
      SCALE: 1.25,
      DX: 360 - 99 * 1.25,
      DY: 660 - 504 * 1.25,
      // Faster durations — snappier opening
      DURS: [0.28, 0.18, 0.14, 0.11, 0.09, 0.07, 0.09, 0.35],
      // Box opening position in canvas space (where pets spring from)
      BOX_OPEN_CY: 580,
    };
  }

  _toBoxReveal() {
    this.state = STATE.BOX_REVEAL;

    this._box = {
      frame: 0, elapsed: 0, flashAlpha: 0, done: false,
      // OPEN sub-phase state
      subPhase:   'ANIMATING',   // 'ANIMATING' | 'OPEN'
      signY:      -300,          // tweens down to final position
      handAlpha:  0,
      handCx:     152,   // starts at pet 0
      handCy:     750,
      handTarget: 0,     // which pet (0/1/2) the hand is heading to
      handTimer:  0,     // time spent at current pet
      petCxs:     [360, 360, 360],
      petCys:     [580, 580, 580],
      petScales:  [0.1, 0.1, 0.1],
      petAlphas:  [0, 0, 0],
    };

    // Create the 3 pet renderers (reused from here into the select experience)
    this._selectRenderers = CONFIG.pets.map((pet, i) => {
      const r = new PetRenderer(this._canvas);
      r.scale = 0.1;
      r.cx = 360;
      r.cy = 580;
      r.playAnim(pet.id, 'idle-1');
      r._frame = Math.floor(Math.random() * 8);
      return r;
    });

    const el = buildBoxRevealOverlay(() => this._skipBoxReveal());
    this._show(el);
    this._runBoxSequence();
  }

  async _runBoxSequence() {
    const B2 = Game._BOX;
    const b  = this._box;
    const FINAL_CX = [152, 362, 572];
    const FINAL_CY = [710, 700, 710];
    const FINAL_SCALE = 1.35;

    // ── Phase 1: play box opening frames ──────────────────────────────────
    for (let f = 0; f < B2.FRAMES; f++) {
      if (b.done) return;
      b.frame = f;
      b.elapsed = 0;

      if (f === 2) Audio.tone(220, 0.08, 'sawtooth', 0.1);
      if (f === 4) Audio.play('bell');
      if (f === 5) {
        b.flashAlpha = 0.9;
        tween(b, { flashAlpha: 0 }, 0.4, Ease.easeOutCubic);
        this._particles.burst(CW / 2, 480);
        this._particles.burst(CW * 0.25, 500);
        this._particles.burst(CW * 0.75, 500);
        Audio.play('cheer', { volume: 0.55 });
      }
      await wait(B2.DURS[f]);
    }

    if (b.done) return;
    b.subPhase = 'OPEN';
    // Remove DOM overlay so canvas receives pet tap events directly
    this._uiRoot.innerHTML = '';

    // ── Phase 2: sign slides down ──────────────────────────────────────────
    tween(b, { signY: 70 }, 0.42, Ease.easeOutBack);
    Audio.tone(523, 0.2, 'sine', 0.18);
    await wait(0.22);

    // ── Phase 3: pets spring out of box, staggered ───────────────────────
    for (let i = 0; i < 3; i++) {
      if (b.done) return;
      const delay = i * 0.14;
      await wait(delay > 0 ? delay : 0);
      if (b.done) return;

      tween(b.petCxs,   { [i]: FINAL_CX[i] },   0.55, Ease.easeOutElastic);
      tween(b.petCys,   { [i]: FINAL_CY[i] },   0.55, Ease.easeOutElastic);
      tween(b.petScales,{ [i]: FINAL_SCALE },    0.45, Ease.easeOutBack);
      tween(b.petAlphas,{ [i]: 1 },              0.25, Ease.easeOutCubic);

      this._particles.emit(360, B2.BOX_OPEN_CY, 8,
        { kind: 'sparkle', color: '#ffe066', speed: 260, size: 13, lifetime: 0.7, upBias: 0.9 });
      Audio.play(`pet-${i + 1}`, { volume: 0.7 });
      Audio.play('jump', { volume: 0.5 });
    }

    await wait(0.5);
    if (b.done) return;

    // ── Phase 4: hand pointer appears ─────────────────────────────────────
    tween(b, { handAlpha: 1 }, 0.3, Ease.easeOutCubic);
  }

  _skipBoxReveal() {
    if (!this._box || this._box.done) return;
    this._box.done = true;
    this._uiRoot.innerHTML = ''; // Remove overlay so canvas gets taps
    this._box.subPhase = 'OPEN';
    CONFIG.pets.forEach((pet, i) => {
      if (!this._selectRenderers[i]) return;
      this._selectRenderers[i].cx    = [152, 362, 572][i];
      this._selectRenderers[i].cy    = [710, 700, 710][i];
      this._selectRenderers[i].scale = 1.35;
    });
    this._box.petCxs    = [152, 362, 572];
    this._box.petCys    = [710, 700, 710];
    this._box.petScales = [1.35, 1.35, 1.35];
    this._box.petAlphas = [1, 1, 1];
    this._box.signY     = 70;
    this._box.handAlpha = 1;
    this._box.done      = false; // keep state alive so OPEN renders
  }

  _drawBoxReveal(ctx, dt) {
    const b  = this._box;
    if (!b || !this._boxSpriteImg) return;
    b.elapsed += dt;

    const B2 = Game._BOX;
    const { FRAME_W, FRAME_H, SCALE, DX, DY } = B2;

    // Always draw open box frame (7) once OPEN, else current animated frame
    const frame = b.subPhase === 'OPEN' ? 7 : b.frame;
    ctx.drawImage(
      this._boxSpriteImg,
      frame * FRAME_W, 0, FRAME_W, FRAME_H,
      DX, DY, FRAME_W * SCALE, FRAME_H * SCALE
    );

    if (b.subPhase === 'OPEN') {
      // Sign slides down from top
      const sw = 420, sh = Math.round(420 * 448 / 587);
      drawFrame(ctx, 'texture-elements', 'sign.png', CW/2 - sw/2, b.signY, sw, sh);
      _drawBrandText(ctx, 'Who will you adopt?', CW/2, b.signY + sh * 0.84, 34, B.darkBrown, '#ffffff');

      // 3 pets springing out
      for (let i = 0; i < 3; i++) {
        const alpha = b.petAlphas[i];
        if (alpha < 0.01) continue;
        const r = this._selectRenderers[i];
        r.cx    = b.petCxs[i];
        r.cy    = b.petCys[i];
        r.scale = b.petScales[i];
        r.update(dt);
        ctx.save();
        ctx.globalAlpha = alpha;
        r.draw();
        ctx.restore();
      }

      // Hand pointer — cycles pet0 → pet1 → pet2 → pet0 ...
      if (b.handAlpha > 0.01) {
        const PET_HAND_X = [152, 362, 572];
        const PET_HAND_Y = [760, 750, 760]; // just below each pet

        // Advance cycle timer
        b.handTimer += dt;
        const DWELL = 0.85;   // seconds to pause on each pet
        if (b.handTimer >= DWELL) {
          b.handTimer = 0;
          b.handTarget = (b.handTarget + 1) % 3;
        }

        // Smooth lerp toward current target
        const speed = dt * 9;
        b.handCx += (PET_HAND_X[b.handTarget] - b.handCx) * Math.min(speed, 1);
        b.handCy += (PET_HAND_Y[b.handTarget] - b.handCy) * Math.min(speed, 1);

        // Tap bounce: quick downward pulse as the hand arrives
        const proximity = Math.abs(b.handCx - PET_HAND_X[b.handTarget]) < 8;
        const tapBounce = proximity ? Math.sin(b.handTimer * Math.PI * 3) * 10 : 0;

        const hfd = getFrame('texture-elements', 'hand.png');
        if (hfd) {
          ctx.save();
          ctx.globalAlpha = b.handAlpha;
          ctx.drawImage(hfd.image, hfd.frame.x, hfd.frame.y, hfd.frame.w, hfd.frame.h,
            b.handCx - 47, b.handCy + tapBounce, 95, 80);
          ctx.restore();
        }
      }
    }

    // Logo
    if (this._logoImg) ctx.drawImage(this._logoImg, 10, 20, 240, 140);

    // Flash overlay
    if (b.flashAlpha > 0.01) {
      ctx.fillStyle = `rgba(255,240,180,${b.flashAlpha})`;
      ctx.fillRect(0, 0, CW, CH);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SELECT
  // ─────────────────────────────────────────────────────────────────────────
  _toSelect() {
    this.state = STATE.SELECT;
    this._show(null);
    this._selectElapsed = 0;

    // Re-init only if renderers weren't already set up by the box reveal
    if (!this._selectRenderers?.length) {
      this._selectRenderers = CONFIG.pets.map((pet, i) => {
        const r = new PetRenderer(this._canvas);
        r.scale = 1.35;
        r.cx = [152, 362, 572][i];
        r.cy = [710, 700, 710][i];
        r.playAnim(pet.id, 'idle-1');
        r._frame = Math.floor(Math.random() * 8);
        return r;
      });
    }
  }

  _handleSelectTap(x, y) {
    for (let i = 0; i < 3; i++) {
      const cx = [152, 362, 572][i];
      const cy = [710, 700, 710][i];
      if (Math.abs(x - cx) < 120 && Math.abs(y - cy) < 140) {
        Audio.play(`pet-${i + 1}`, { volume: 0.9 });
        const r = this._selectRenderers[i];
        if (r) tween(r, { scale: 1.7 }, 0.1, Ease.easeOutCubic,
          () => tween(r, { scale: 1.35 }, 0.1, Ease.easeInCubic));
        this._particles.emit(cx, cy - 40, 10, { kind: 'sparkle', color: '#ffe066', speed: 220, size: 14, lifetime: 0.6 });
        setTimeout(() => this._toZoom(i), 230);
        return;
      }
    }
  }

  _drawSelect(ctx, dt) {
    this._selectElapsed = (this._selectElapsed || 0) + dt;
    const e = this._selectElapsed;

    // Sign
    const sw = 420, sh = Math.round(420 * 448 / 587);
    drawFrame(ctx, 'texture-elements', 'sign.png', CW/2 - sw/2, 70, sw, sh);

    // Sign text (3D brand style)
    _drawBrandText(ctx, 'Who will you adopt?', CW/2, 70 + sh * 0.84, 34, B.darkBrown, '#ffffff');

    // Logo
    if (this._logoImg) ctx.drawImage(this._logoImg, 10, 20, 240, 140);

    // Hand pointer tutorial (fades after 2.5s)
    if (e < 3.0) {
      const handAlpha = Math.max(0, 1 - (e - 2.0));
      const handX = 280 + Math.sin(e * 1.8) * 130;
      const handY = 830;
      const fd = getFrame('texture-elements', 'hand.png');
      if (fd && handAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = handAlpha;
        ctx.drawImage(fd.image, fd.frame.x, fd.frame.y, fd.frame.w, fd.frame.h,
          handX - 47, handY - 40, 95, 80);
        ctx.restore();
      }
    }

    // 3 animated pets with bob
    for (let i = 0; i < this._selectRenderers.length; i++) {
      const r = this._selectRenderers[i];
      const baseCy = [710, 700, 710][i];
      r.cy = baseCy + Math.sin(e * 2 + i * 2.1) * 5;
      r.update(dt);
      r.draw();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ZOOM
  // ─────────────────────────────────────────────────────────────────────────
  _toZoom(petIdx) {
    this.state = STATE.ZOOM;
    this.petIdx = petIdx;
    this.petId  = CONFIG.pets[petIdx].id;

    // Inherit chosen pet's position
    const chosen = this._selectRenderers[petIdx];
    this._renderer.petId  = this.petId;
    this._renderer.cx     = chosen.cx;
    this._renderer.cy     = chosen.cy;
    this._renderer.scale  = chosen.scale;
    this._renderer.playAnim(this.petId, 'idle-1'); this._applyHeadOffsets(this.petId, 0);

    this._selectRenderers = [];

    // Zoom tween — pet stays planted on the dock (floor-anchored cy)
    const zoomCy = this._floorCy(2.8);
    tween(this._renderer, { cx: CW/2, cy: zoomCy, scale: 2.8 }, 0.65, Ease.easeOutBack);

    // Background zooms in sync with the pet
    this._bgZoom = 1.0;
    tween(this, { _bgZoom: 1.18 }, 0.65, Ease.easeOutCubic);


    // Rug slides up from below as the pet zooms in
    this._rugY = CH + 200;
    tween(this, { _rugY: RUG_FINAL_Y }, 0.55, Ease.easeOutBack);
    tween(this, { _vignetteAlpha: 0.5 }, 0.3, Ease.easeOutQuad);

    setTimeout(() => {
      this._particles.burst(CW/2, zoomCy - 80);
      tween(this, { _vignetteAlpha: 0 }, 0.35, Ease.easeOutCubic);
      this._toColorPick();
    }, 700);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COLOR PICK
  // ─────────────────────────────────────────────────────────────────────────
  _toColorPick() {
    this.state = STATE.COLOR_PICK;

    // Arc orbs start above their final positions and float in
    this._color = {
      orbScales: [1, 1, 1],
      orbCys:    [ARC_ORB_Y[0] - 90, ARC_ORB_Y[1] - 90, ARC_ORB_Y[2] - 90],
      orbAlphas: [0, 0, 0],
      selected:  0,
      elapsed:   0,
    };

    this._renderer.cx    = CW / 2;
    this._renderer.cy    = this._floorCy(2.5); // feet on the dock
    this._renderer.scale = 2.5;
    this._renderer.playAnim(this.petId, 'idle-1'); this._applyHeadOffsets(this.petId, 0);
    this._renderer.paused = false;
    this._renderer.stopAccessory();
    this.colorIdx = 0;
    Audio.play('bell', { volume: 0.35 });
    this._showCaption('Make them yours!', 1.8);
    this._panelSlide.y = 0; // no panel slide on color pick

    // Staggered orb float-in
    for (let i = 0; i < 3; i++) {
      wait(i * 0.1).then(() => {
        tween(this._color.orbCys,   { [i]: ARC_ORB_Y[i] }, 0.5, Ease.easeOutElastic);
        tween(this._color.orbAlphas, { [i]: 1 },           0.22, Ease.easeOutCubic);
      });
    }
  }

  _handleColorTap(x, y) {
    // Check each arc orb (circle hit test, r=68)
    for (let i = 0; i < 3; i++) {
      if (this._color.orbAlphas[i] > 0.3 && Math.hypot(x - ARC_ORB_X[i], y - this._color.orbCys[i]) < 85) {
        this.colorIdx = i;
        this._color.selected = i;
        tween(this._color.orbScales, { [i]: 1.28 }, 0.14, Ease.easeOutBack,
          () => tween(this._color.orbScales, { [i]: 1 }, 0.12, Ease.easeOutCubic));
        this._renderer.playAnim(this.petId, `idle-${i + 1}`);
        this._renderer.paused = false; // animate — head/tail movement
        this._particles.emit(ARC_ORB_X[i], this._color.orbCys[i], 10,
          { kind: 'sparkle', color: CONFIG.colors[i].hex, speed: 180, size: 12, lifetime: 0.6 });
        Audio.tone(440 + i * 100, 0.15, 'sine', 0.22);
        return;
      }
    }

    // Next button (fixed position, on the dock)
    if (x >= CW/2 - 120 && x <= CW/2 + 120 && y >= 950 && y <= 1056) {
      Audio.play('timpani', { volume: 0.5 });
      this._petFlash = 1.0;
      tween(this, { _petFlash: 0 }, 0.4, Ease.easeOutCubic);
      for (let i = 0; i < 3; i++) {
        wait(i * 0.05).then(() => {
          tween(this._color.orbCys,    { [i]: this._color.orbCys[i] - 80 }, 0.2, Ease.easeInCubic);
          tween(this._color.orbAlphas, { [i]: 0 },                          0.18, Ease.easeInCubic);
        });
      }
      wait(0.32).then(() => this._toAccPick());
    }
  }

  _drawColorPick(ctx) {
    const e = this._color.elapsed;

    // Soft spotlight behind pet
    const slFd = getFrame('texture-custom-elements', 'color-light.png');
    if (slFd) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.drawImage(slFd.image, slFd.frame.x, slFd.frame.y, slFd.frame.w, slFd.frame.h,
        CW/2 - 190, FLOOR_Y - 420, 380, 380);
      ctx.restore();
    }

    // Pet on dock
    this._renderer.draw();

    // 3 floating arc bubbles — each shows the pet in that color variant
    const pet       = CONFIG.pets[this.petIdx];
    const BUBBLE_R  = 80;  // circle radius

    for (let i = 0; i < 3; i++) {
      const alpha = this._color.orbAlphas[i];
      if (alpha < 0.01) continue;

      const s          = this._color.orbScales[i];
      const bobY       = Math.sin(e * 1.8 + i * 2.1) * 6;
      const cy         = this._color.orbCys[i] + bobY;
      const isSelected = this._color.selected === i;

      // Get first frame of idle-{i+1} for this pet
      const frames = getFramesByPrefix(pet.atlases, `${this.petId}-idle-${i + 1}-`);
      if (!frames.length) continue;
      const fd = getFrame(frames[0].atlas, frames[0].frame);
      if (!fd) continue;

      ctx.save();
      ctx.globalAlpha = alpha * (isSelected ? 1 : 0.72);
      ctx.translate(ARC_ORB_X[i], cy);
      ctx.scale(s, s);

      // Glow behind selected bubble
      if (isSelected) {
        ctx.shadowColor = B.orange;
        ctx.shadowBlur  = 32;
      }

      // Circular clip + parchment background
      ctx.beginPath();
      ctx.arc(0, 0, BUBBLE_R, 0, Math.PI * 2);
      ctx.fillStyle = '#f5e6c8';
      ctx.fill();
      ctx.shadowBlur = 0;

      // Pet thumbnail — bottom-anchored inside the circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, BUBBLE_R - 3, 0, Math.PI * 2);
      ctx.clip();

      const effectiveH = Math.max(fd.sourceSize.w, fd.sourceSize.h);
      const petScale   = (BUBBLE_R * 1.85) / effectiveH;
      const dw = fd.naturalW * petScale;
      const dh = fd.naturalH * petScale;
      // Bottom-anchor at +BUBBLE_R so feet touch the bottom of the circle
      const dx = -dw / 2;
      const dy = BUBBLE_R - dh;
      if (!fd.rotated) {
        ctx.drawImage(fd.image, fd.frame.x, fd.frame.y, fd.frame.w, fd.frame.h, dx, dy, dw, dh);
      } else {
        // Atlas frame stored 90°CW — rotate -90° to draw upright
        ctx.save();
        ctx.translate(dx + dw / 2, dy + dh / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(fd.image, fd.frame.x, fd.frame.y, fd.frame.w, fd.frame.h,
          -dh / 2, -dw / 2, dh, dw);
        ctx.restore();
      }
      ctx.restore();

      // Border ring
      ctx.strokeStyle = isSelected ? B.orange : B.brown;
      ctx.lineWidth   = isSelected ? 7 : 4;
      ctx.beginPath();
      ctx.arc(0, 0, BUBBLE_R, 0, Math.PI * 2);
      ctx.stroke();

      // Inner highlight when selected
      if (isSelected) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth   = 3;
        ctx.beginPath();
        ctx.arc(0, 0, BUBBLE_R - 12, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }

    // "Pick a color!" instruction — sits clearly above the arc orbs
    _drawBrandText(ctx, 'Pick a color!', CW/2, ARC_ORB_Y[1] - 118, 30, B.darkBrown, '#ffffff');

    // Next button — moved up onto the dock area
    drawFrame(ctx, 'texture-elements', 'btn-next.png', CW/2 - 120, 950, 240, 106);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACCESSORY PICK
  // ─────────────────────────────────────────────────────────────────────────
  _toAccPick() {
    this.state = STATE.ACC_PICK;
    this._acc = {
      orbScales: [1, 1, 1],
      orbCys:    [ARC_ORB_Y[0] - 90, ARC_ORB_Y[1] - 90, ARC_ORB_Y[2] - 90],
      orbAlphas: [0, 0, 0],
      selected:  -1,
      elapsed:   0,
    };
    this._renderer.cy    = this._floorCy(2.5);
    this._renderer.scale = 2.5;
    this._renderer.playAnim(this.petId, `idle-${this.colorIdx + 1}`); this._applyHeadOffsets(this.petId, this.colorIdx);
    
    this._renderer.stopAccessory();
    this.accIdx = -1;
    Audio.tone(587, 0.18, 'sine', 0.32); // D5 — slightly higher chime than color pick
    this._showCaption('Dress them up!', 1.8);
    this._panelSlide.y = 0;

    // Staggered orb float-in
    for (let i = 0; i < 3; i++) {
      wait(i * 0.1).then(() => {
        tween(this._acc.orbCys,    { [i]: ARC_ORB_Y[i] }, 0.5, Ease.easeOutElastic);
        tween(this._acc.orbAlphas, { [i]: 1 },            0.22, Ease.easeOutCubic);
      });
    }
  }

  _handleAccTap(x, y) {
    // Circle hit test on each arc bubble (r=68)
    for (let i = 0; i < 3; i++) {
      if (this._acc.orbAlphas[i] > 0.3 && Math.hypot(x - ARC_ORB_X[i], y - this._acc.orbCys[i]) < 85) {
        this.accIdx = i;
        this._acc.selected = i;
        tween(this._acc.orbScales, { [i]: 1.28 }, 0.14, Ease.easeOutBack,
          () => tween(this._acc.orbScales, { [i]: 1 }, 0.12, Ease.easeOutCubic));
        this._renderer.playAnim(this.petId, `idle-${this.colorIdx + 1}`); this._applyHeadOffsets(this.petId, this.colorIdx);
        
        this._renderer.playAccessory(this.petId, i, this.colorIdx);
        this._particles.emit(ARC_ORB_X[i], this._acc.orbCys[i], 10,
          { kind: 'sparkle', color: '#ffe066', speed: 200, size: 12, lifetime: 0.6 });
        Audio.play('suction', { volume: 0.7 });
        return;
      }
    }

    // Adopt button — on the dock, same level as color screen
    if (x >= CW/2 - 120 && x <= CW/2 + 120 && y >= 950 && y <= 1056) {
      Audio.play('timpani', { volume: 0.5 });
      this._petFlash = 1.0;
      tween(this, { _petFlash: 0 }, 0.4, Ease.easeOutCubic);
      // Orbs exit upward before transitioning
      for (let i = 0; i < 3; i++) {
        wait(i * 0.05).then(() => {
          tween(this._acc.orbCys,    { [i]: this._acc.orbCys[i] - 80 }, 0.2, Ease.easeInCubic);
          tween(this._acc.orbAlphas, { [i]: 0 },                        0.18, Ease.easeInCubic);
        });
      }
      wait(0.32).then(() => this._toCTA()); // skip separate MINIGAME, go straight to final screen
    }
  }

  _drawAccPick(ctx) {
    const e = this._acc.elapsed;

    // Accessory spotlight behind pet
    const asFd = getFrame('texture-custom-elements', 'accessory-light.png');
    if (asFd) {
      ctx.save(); ctx.globalAlpha = 0.45;
      ctx.drawImage(asFd.image, asFd.frame.x, asFd.frame.y, asFd.frame.w, asFd.frame.h,
        CW/2 - 190, FLOOR_Y - 420, 380, 380);
      ctx.restore();
    }

    // Pet on dock
    this._renderer.draw();

    // 3 floating arc accessory bubbles above the pet
    const pet    = CONFIG.pets[this.petIdx];
    const labels = pet.accessories.map(a => a.label);
    const BUBBLE_R = 72;  // radius of the circular bubble background

    for (let i = 0; i < 3; i++) {
      const alpha = this._acc.orbAlphas[i];
      if (alpha < 0.01) continue;

      const s         = this._acc.orbScales[i];
      const bobY      = Math.sin(e * 1.8 + i * 2.1) * 6;
      const cy        = this._acc.orbCys[i] + bobY;
      const isSelected = this._acc.selected === i;

      ctx.save();
      ctx.globalAlpha = alpha * (isSelected ? 1 : 0.75);
      ctx.translate(ARC_ORB_X[i], cy);
      ctx.scale(s, s);

      // Parchment circle background (matches color bubble style)
      if (isSelected) {
        ctx.shadowColor = B.orange;
        ctx.shadowBlur  = 28;
      }
      ctx.beginPath();
      ctx.arc(0, 0, BUBBLE_R, 0, Math.PI * 2);
      ctx.fillStyle = '#f5e6c8';
      ctx.fill();
      ctx.shadowBlur = 0;

      // Use last frame (settled/resting position) — same as playAccessory()
      const accFrames = getFramesByPrefix(['texture-pet-accessories'],
        `${this.petId}-accessory${i + 1}-`);
      if (accFrames.length > 0) {
        const af  = accFrames[accFrames.length - 1];
        const afd = getFrame(af.atlas, af.frame);
        if (afd) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(0, 0, BUBBLE_R - 3, 0, Math.PI * 2);
          ctx.clip();
          const sc = Math.min((BUBBLE_R * 1.4) / afd.naturalW, (BUBBLE_R * 1.4) / afd.naturalH);
          const aw = afd.naturalW * sc, ah = afd.naturalH * sc;
          if (!afd.rotated) {
            ctx.drawImage(afd.image, afd.frame.x, afd.frame.y, afd.frame.w, afd.frame.h,
              -aw/2, -ah/2, aw, ah);
          } else {
            ctx.save();
            ctx.translate(0, 0);
            ctx.rotate(-Math.PI / 2);
            ctx.drawImage(afd.image, afd.frame.x, afd.frame.y, afd.frame.w, afd.frame.h,
              -ah/2, -aw/2, ah, aw);
            ctx.restore();
          }
          ctx.restore();
        }
      }

      // Border ring
      ctx.strokeStyle = isSelected ? B.orange : B.brown;
      ctx.lineWidth   = isSelected ? 7 : 4;
      ctx.beginPath(); ctx.arc(0, 0, BUBBLE_R, 0, Math.PI * 2); ctx.stroke();
      if (isSelected) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, BUBBLE_R - 12, 0, Math.PI * 2); ctx.stroke();
      }

      // Label below bubble
      ctx.font = `bold 20px ${B.font}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.lineWidth = 4; ctx.strokeStyle = B.darkBrown;
      ctx.strokeText(labels[i], 0, BUBBLE_R + 6);
      ctx.fillStyle = isSelected ? B.orange : '#fff';
      ctx.fillText(labels[i], 0, BUBBLE_R + 6);

      ctx.restore();
    }

    // "Pick an accessory!" instruction above the arc orbs
    _drawBrandText(ctx, 'Pick an accessory!', CW/2, ARC_ORB_Y[1] - 118, 30, B.darkBrown, '#ffffff');

    // Adopt button — moved up onto the dock (same level as color screen Next)
    drawFrame(ctx, 'texture-elements', 'btn-adopt.png', CW/2 - 120, 950, 240, 106);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MINIGAME CAROUSEL
  // ─────────────────────────────────────────────────────────────────────────
  _toMinigame() {
    this.state = STATE.MINIGAME;

    // Smaller scale so cards fit below — pet on dock floor, slightly smaller
    this._renderer.cx    = CW / 2;
    this._renderer.cy    = this._floorCy(2.0);
    this._renderer.scale = 2.0;
    this._renderer.playAnim(this.petId, `idle-${this.colorIdx + 1}`); this._applyHeadOffsets(this.petId, this.colorIdx);
    if (this.accIdx >= 0) this._renderer.playAccessory(this.petId, this.accIdx, this.colorIdx);
    else this._renderer.stopAccessory();

    this._carousel = {
      scrollX: 0, swipeStartX: null, swipeDelta: 0, elapsed: 0,
      cardScales: Array(CONFIG.gameCards.length).fill(1.0), // smooth scale lerp
      centerCard: -1, // currently centered card index (for emote + audio)
    };
    this._lastCardPastCenter = -1;
    Audio.tone(392, 0.2, 'sine', 0.28); // G4 — entry chime
    this._showCaption('Play together!', 2.0);

    const el = buildMinigameOverlay();
    this._show(el);

    // Auto-advance fallback
    this._carouselTimer = setTimeout(() => this._toCTA(), CONFIG.carouselDuration * 1000);
  }

  _drawMinigame(ctx, dt) {
    const c = this._carousel;
    c.elapsed += dt;
    c.scrollX += 140 * dt; // slightly snappier than before

    const CARDS = CONFIG.gameCards;
    const CRD_W = 220, CRD_H = 230, CRD_GAP = 20; // smaller cards
    const STEP  = CRD_W + CRD_GAP;
    const TOTAL = CARDS.length * STEP;
    // Cards sit BELOW the pet on the dock shelf
    const cardY = 630;

    // Seamless loop
    const rawX = (c.scrollX + c.swipeDelta) % TOTAL;

    // Heading above the pet
    _drawBrandText(ctx, 'Discover Games Inside!', CW/2, 42, 26, B.darkBrown, B.orange);

    // Pet (larger, front and center above the cards)
    this._renderer.draw();

    // Emote icon cycles with the centered card
    const EMOTES = [
      'icn_emote_suprised.png', 'icn_emote_wink.png', 'icn_emote_cool.png',
      'icn_emote_grin.png', 'icn_emote_tongue.png',
    ];
    const emoteKey = EMOTES[Math.abs(c.centerCard ?? 0) % EMOTES.length];
    const efFd = getFrame('texture-elements', emoteKey);
    if (efFd) {
      const bobY = Math.sin(c.elapsed * 3) * 8;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.drawImage(efFd.image, efFd.frame.x, efFd.frame.y, efFd.frame.w, efFd.frame.h,
        CW/2 + 60, 530 + bobY, 60, 64);
      ctx.restore();
    }

    // Cards scroll below the pet
    let nearestDist = Infinity, nearestCard = -1;
    for (let copy = 0; copy < 3; copy++) {
      for (let i = 0; i < CARDS.length; i++) {
        const cardX = -rawX + (copy - 1) * TOTAL + i * STEP + (CW - CRD_W) / 2;
        if (cardX > CW + CRD_W || cardX < -(CRD_W + 20)) continue;

        const dist = Math.abs(cardX + CRD_W/2 - CW/2);

        // Track nearest card for emote + dot indicator
        if (dist < nearestDist) { nearestDist = dist; nearestCard = i; }

        // Smooth scale lerp (items 6+8)
        const target = dist < CRD_W * 0.85 ? 1.1 : 1.0;
        c.cardScales[i] = c.cardScales[i] + (target - c.cardScales[i]) * Math.min(dt * 12, 1);
        const s = c.cardScales[i];

        ctx.save();
        if (s > 1.005) {
          const cx2 = cardX + CRD_W/2, cy2 = cardY + CRD_H/2;
          ctx.translate(cx2, cy2); ctx.scale(s, s); ctx.translate(-cx2, -cy2);
          ctx.shadowColor = 'rgba(255,200,50,0.45)'; ctx.shadowBlur = 22;
        }
        this._drawGameIconCard(ctx, CARDS[i], cardX, cardY, CRD_W, CRD_H);
        ctx.restore();

        // Card-center chime + sparkle (item 5+7)
        if (dist < 25 && this._lastCardPastCenter !== copy * 100 + i) {
          this._lastCardPastCenter = copy * 100 + i;
          const pitch = 523 + i * 40;
          Audio.tone(pitch, 0.06, 'sine', 0.12);
          this._particles.emit(CW/2, cardY - 10, 5,
            { kind: 'sparkle', color: '#ffe066', speed: 130, size: 9, lifetime: 0.5 });
        }
      }
    }

    // Update dot indicators + emote card (item 5)
    if (nearestCard !== c.centerCard) {
      c.centerCard = nearestCard;
      const dots = this._uiRoot.querySelectorAll('.dot');
      dots.forEach((d, idx) => d.classList.toggle('active', idx === nearestCard));
    }
  }

  _drawGameIconCard(ctx, card, x, y, W, H) {
    const cardIdx = CONFIG.gameCards.indexOf(card);
    const gameImg = this._gameImgs?.[cardIdx];

    ctx.save();

    // Deep shadow
    ctx.shadowColor   = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur    = 26;
    ctx.shadowOffsetY = 9;

    // Card base
    ctx.beginPath();
    _roundedRectPath(ctx, x, y, W, H, 20);
    ctx.fillStyle = '#1a1030';
    ctx.fill();

    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.beginPath();
    _roundedRectPath(ctx, x, y, W, H, 20);
    ctx.clip();

    if (gameImg) {
      // Full-bleed game image — fills entire card
      ctx.drawImage(gameImg, x, y, W, H);
    } else {
      ctx.fillStyle = card.bgColor || '#333';
      ctx.fillRect(x, y, W, H);
    }

    // Bottom gradient for text legibility
    const grad = ctx.createLinearGradient(x, y + H * 0.42, x, y + H);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.60)');
    grad.addColorStop(1,    'rgba(0,0,0,0.90)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y + H * 0.42, W, H * 0.58);

    // Game title
    ctx.font = `bold 19px ${B.font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 6;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(card.title, x + W/2, y + H - 34);
    ctx.shadowBlur = 0;

    // Gold star rating
    ctx.font = 'bold 13px Arial';
    ctx.fillStyle = '#ffd700';
    ctx.fillText('★★★★★', x + W/2, y + H - 14);

    // "FREE" badge — top right
    const bw = 44, bh = 22, br = 6;
    const bx = x + W - bw - 9, by = y + 9;
    ctx.beginPath();
    _roundedRectPath(ctx, bx, by, bw, bh, br);
    ctx.fillStyle = '#00c853';
    ctx.fill();
    ctx.font = 'bold 11px "Arial Black", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'transparent';
    ctx.fillText('FREE', bx + bw/2, by + bh/2 + 1);

    // Glass shine — top-left diagonal highlight
    const shine = ctx.createLinearGradient(x, y, x + W * 0.65, y + H * 0.45);
    shine.addColorStop(0, 'rgba(255,255,255,0.20)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    ctx.fillRect(x, y, W * 0.65, H * 0.45);

    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CTA — combined final screen: character jump-in + game carousel + play btn
  // ─────────────────────────────────────────────────────────────────────────
  _toCTA() {
    if (this._carouselTimer) clearTimeout(this._carouselTimer);
    this.state = STATE.CTA;
    this._ctaElapsed = 0;
    this._show(null);

    // Pet enters jumping up from below with accessory
    this._renderer.cx    = CW / 2;
    this._renderer.cy    = CH + 300;   // off-screen bottom
    this._renderer.scale = 0.4;
    this._renderer.playAnim(this.petId, `idle-${this.colorIdx + 1}`); this._applyHeadOffsets(this.petId, this.colorIdx);
    if (this.accIdx >= 0) this._renderer.playAccessory(this.petId, this.accIdx, this.colorIdx);

    // Jump tween — smaller scale so pet sits on the rug, not towering above it
    const finalCy = this._floorCy(1.4);
    tween(this._renderer, { cy: finalCy, scale: 1.4 }, 0.75, Ease.easeOutBack);
    tween(this, { _bgZoom: 1.0 }, 0.6, Ease.easeOutCubic);

    // Celebration on landing
    wait(0.65).then(() => {
      this._particles.burst(CW/2, finalCy - 80);
      this._particles.burst(CW * 0.25, finalCy - 40);
      this._particles.burst(CW * 0.75, finalCy - 40);
      Audio.play('cheer', { volume: 0.7 });
      Audio.play('bell',  { volume: 0.5 });
    });

    // Vertical slot-machine reel state
    this._carousel = {
      scrollX: 0, scrollY: 0,   // scrollY drives the vertical reel
      swipeStartX: null, swipeDelta: 0, elapsed: 0,
      cardScales: Array(CONFIG.gameCards.length).fill(1.0),
      centerCard: -1,
    };
    this._lastCardPastCenter = -1;

    this._bgZoom = 1.0; // reset zoom for cta background
  }

  _handleCtaTap(x, y) {
    // Game icon grid (3×2, y=840–1116)
    if (y >= 840 && y <= 1120) { this._doInstall(); return; }
    // Play for Free! button at bottom
    if (x >= CW/2 - 210 && x <= CW/2 + 210 && y >= 1135 && y <= 1205) { this._doInstall(); return; }
  }
  _doInstall() {
    this._particles.burst(CW/2, FLOOR_Y - 100);
    Audio.play('cheer', { volume: 0.55 });
    setTimeout(() => window.open(CONFIG.targetUrl, '_blank'), 150);
  }

  _drawCTA(ctx, dt) {
    const c = this._carousel;
    c.elapsed += dt;

    // Sparse confetti
    if (Math.random() < 0.06) {
      this._particles.emit(Math.random() * CW, -10, 1,
        { kind: 'confetti', speed: 125, gravity: 200, lifetime: 2.5 });
    }

    // Dark gradient over bottom 40%
    const darkGrad = ctx.createLinearGradient(0, CH * 0.58, 0, CH);
    darkGrad.addColorStop(0,   'rgba(0,0,0,0)');
    darkGrad.addColorStop(0.3, 'rgba(0,0,0,0.38)');
    darkGrad.addColorStop(1,   'rgba(0,0,0,0.78)');
    ctx.fillStyle = darkGrad;
    ctx.fillRect(0, CH * 0.58, CW, CH);

    // 1. Animal Jam logo — moved down slightly for better breathing room
    if (this._logoImg) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 18;
      ctx.drawImage(this._logoImg, CW/2 - 148, 42, 296, 208);
      ctx.restore();
    }

    // 2. Social proof badge — right below logo
    _drawSocialProofBadge(ctx, CW/2, 262);

    // 4. Tagline — above the pet, in the scenic sky zone (bigger + readable)
    const petLabel = (CONFIG.pets[this.petIdx]?.label ?? 'Pet').toUpperCase();
    ctx.save();
    ctx.font = `bold 36px ${CONFIG.brand.fontDimbo}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = B.darkBrown;
    ctx.strokeText('Adopt, Explore, Decorate & Play', CW/2, 352);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Adopt, Explore, Decorate & Play', CW/2, 352);
    ctx.restore();
    _drawBrandText(ctx, `Games with YOUR ${petLabel}!`, CW/2, 422, 58, B.darkBrown, B.orange);

    // 5. Pet on rug (hero)
    this._renderer.draw();

    // 6. 3×2 game icon grid — all 6 games, centered within mobile-safe zone
    // Safe zone: canvas x=80–640 (accounts for COVER clipping on narrow phones)
    // gridW = 3*132 + 2*12 = 420px → startX = (720-420)/2 = 150 ✓ safe
    const ICN = 132, ICN_GAP = 12, COLS = 3;
    const gridW = COLS * ICN + (COLS - 1) * ICN_GAP;
    const gridX = (CW - gridW) / 2;  // 150

    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col;
        const img = this._gameImgs?.[idx];
        const ix  = gridX + col * (ICN + ICN_GAP);
        const iy  = 840 + row * (ICN + ICN_GAP);  // row0: y=840, row1: y=984
        _drawGameIconMini(ctx, img, ix, iy, ICN);
      }
    }

    // 7. "Play for Free!" button — single CTA at bottom
    const pulse = 1 + Math.sin(this._ctaElapsed * 3.5) * 0.032;
    ctx.save();
    ctx.translate(CW/2, 1168 + 35); ctx.scale(pulse, pulse); ctx.translate(-CW/2, -(1168 + 35));
    _drawCTAButton(ctx, CW/2 - 210, 1135, 420, 70);
    ctx.restore();

    // 8. Copyright
    ctx.font = `13px ${CONFIG.brand.fontBody}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('\u00a9 2026 WildWorks. All rights reserved.', CW/2, 1220);
  }
  _show(el) {
    this._uiRoot.innerHTML = '';
    if (el) this._uiRoot.appendChild(el);
  }
}

// ── Canvas helpers ────────────────────────────────────────────────────────

function _roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function _roundedRectPath(ctx, x, y, w, h, r) {
  _roundedRect(ctx, x, y, w, h, r);
}

function _drawWoodBox(ctx, x, y, w, h, fillColor, strokeColor) {
  ctx.save();
  _roundedRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = fillColor;
  ctx.fill();
  // Wood grain lines
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 10, y + h * i / 4);
    ctx.lineTo(x + w - 10, y + h * i / 4);
    ctx.stroke();
  }
  ctx.strokeStyle = strokeColor; ctx.lineWidth = 4;
  _roundedRect(ctx, x, y, w, h, 12);
  ctx.stroke();
  ctx.restore();
}

function _drawBrandText(ctx, text, x, y, size, strokeColor, fillColor, fontFace) {
  ctx.save();
  ctx.font = `bold ${size}px ${fontFace ?? CONFIG.brand.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineCap  = 'round';
  const lw = Math.ceil(size * 0.22);

  // 3D depth: dark shadow offset layer first
  const depth = Math.ceil(size * 0.08);
  ctx.lineWidth = lw;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.strokeText(text, x + depth, y + depth);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillText(text, x + depth, y + depth);

  // Main stroke (dark outline)
  ctx.lineWidth = lw;
  ctx.strokeStyle = strokeColor;
  ctx.strokeText(text, x, y);

  // Main fill (bright color)
  ctx.fillStyle = fillColor;
  ctx.fillText(text, x, y);

  ctx.restore();
}

function _drawCardBgStyle(ctx, style, x, y, w, h, baseColor) {
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;

  if (style === 'sunburst') {
    const cx = x + w/2, cy = y + h/2;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * w, cy + Math.sin(a) * h);
      ctx.stroke();
    }
  } else if (style === 'dots') {
    ctx.fillStyle = '#ffffff';
    for (let row = 0; row < 5; row++) for (let col = 0; col < 4; col++) {
      ctx.beginPath();
      ctx.arc(x + 28 + col * 60, y + 24 + row * 58, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (style === 'clouds') {
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.25;
    for (const [cx, cy, r] of [[x+50,y+60,28],[x+160,y+40,22],[x+120,y+80,20]]) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
    }
  } else if (style === 'gems') {
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.22;
    for (let i = 0; i < 4; i++) {
      const gx = x + 40 + i * 52, gy = y + 40 + (i%2)*30;
      ctx.beginPath();
      ctx.moveTo(gx, gy - 16); ctx.lineTo(gx + 12, gy);
      ctx.lineTo(gx, gy + 10); ctx.lineTo(gx - 12, gy);
      ctx.closePath(); ctx.fill();
    }
  } else if (style === 'stars') {
    // Deterministic positions using trig as seeded pseudo-random (no Math.random = no flicker)
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.28;
    for (let i = 0; i < 10; i++) {
      const sx = x + 12 + (Math.abs(Math.sin(i * 7.391)) * (w - 24));
      const sy = y + 10 + (Math.abs(Math.cos(i * 4.817)) * (h * 0.62));
      const sr = 2 + Math.abs(Math.sin(i * 2.13)) * 6;
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Decorative oval rug/mat that appears on the dock under the pet.
 * rugY = top edge of the rug center line.
 */
/**
 * Small rounded game icon thumbnail for the 3×2 grid on the CTA screen.
 * Simpler than _drawGameIconCard — just image + rounded clip + shadow.
 */
function _drawGameIconMini(ctx, img, x, y, size) {
  ctx.save();
  // Draw shadow on the base rect before clipping
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
  ctx.beginPath(); _roundedRectPath(ctx, x, y, size, size, 18);
  ctx.fillStyle = '#1a1a2e'; ctx.fill();
  // Clear shadow then clip so it doesn't bleed onto the image
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.beginPath(); _roundedRectPath(ctx, x, y, size, size, 18);
  ctx.clip();
  if (img) ctx.drawImage(img, x, y, size, size);
  ctx.restore();
}

function _drawSocialProofBadge(ctx, cx, cy) {
  const label = '⭐  Played by 50M+ Jammers';
  ctx.save();
  ctx.font = `bold 15px ${CONFIG.brand.fontBody}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const tw   = ctx.measureText(label).width;
  const pw   = tw + 28, ph = 28, r = ph / 2;
  const px   = cx - pw / 2;
  const pyd  = cy - ph / 2;

  // Pill background — semi-transparent dark with warm border
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 8;
  _pillPath(ctx, px, pyd, pw, ph, r);
  ctx.fillStyle = 'rgba(20,12,4,0.55)';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#f7941d'; ctx.lineWidth = 1.5;
  ctx.stroke();

  // Label
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, cx, cy);

  ctx.restore();
}

function _drawRug(ctx, rugY) {
  const cx    = CW / 2;
  const cy    = rugY + 55;   // vertical center of the rug
  const rx    = 280;         // horizontal radius
  const ry    = 52;          // vertical radius (flat oval)

  ctx.save();

  // Drop shadow
  ctx.shadowColor  = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur   = 18;
  ctx.shadowOffsetY = 8;

  // Main oval fill — warm AJ amber
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  const grad = ctx.createRadialGradient(cx, cy - 10, 20, cx, cy, rx);
  grad.addColorStop(0,   '#e8a030');
  grad.addColorStop(0.6, '#c87820');
  grad.addColorStop(1,   '#a05810');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.shadowColor = 'transparent';

  // Outer border
  ctx.strokeStyle = '#7b4c2a';
  ctx.lineWidth   = 5;
  ctx.stroke();

  // Inner decorative ring
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx - 18, ry - 14, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,200,80,0.55)';
  ctx.lineWidth   = 3;
  ctx.stroke();

  // 5 small star dots along the inner ring
  ctx.fillStyle = 'rgba(255,220,100,0.7)';
  for (let i = 0; i < 5; i++) {
    const a  = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const sx = cx + Math.cos(a) * (rx - 35);
    const sy = cy + Math.sin(a) * (ry - 18);
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Top highlight gleam
  ctx.beginPath();
  ctx.ellipse(cx - 30, cy - 18, rx * 0.45, ry * 0.3, -0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,240,180,0.22)';
  ctx.fill();

  ctx.restore();
}

function _drawCTAButton(ctx, x, y, w, h) {
  const r = h / 2;
  ctx.save();
  ctx.shadowColor  = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur   = 14;
  ctx.shadowOffsetY = 5;

  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0,   '#7ae042');
  grad.addColorStop(0.5, '#4bb81a');
  grad.addColorStop(1,   '#368a10');
  ctx.fillStyle = grad;
  _pillPath(ctx, x, y, w, h, r); ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#236a08'; ctx.lineWidth = 3; ctx.stroke();

  // Highlight gleam
  const gleam = ctx.createLinearGradient(x, y + 2, x, y + h * 0.45);
  gleam.addColorStop(0, 'rgba(255,255,255,0.40)');
  gleam.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gleam;
  _pillPath(ctx, x + 3, y + 3, w - 6, h * 0.44, r - 3); ctx.fill();

  ctx.font = `bold 34px ${CONFIG.brand.fontDimbo}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Play for Free!', x + w/2, y + h/2 + 1);
  ctx.restore();
}

function _pillPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
