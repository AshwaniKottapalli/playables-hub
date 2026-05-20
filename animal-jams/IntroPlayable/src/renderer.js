import { getFramesByPrefix, getFrame } from './atlas.js';
import { CONFIG } from './config.js';

export class PetRenderer {
  constructor(canvas) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext('2d');
    this.petId    = null;
    this._anim    = null;
    this._frame   = 0;
    this._elapsed = 0;
    this._loop    = true;
    this._onComplete = null;
    this.scale    = 1;
    this.cx       = null;  // null = canvas center
    this.cy       = null;
    this._accFrameData = null; // single static frame, no animation
    this.paused = false;      // when true, update() holds on current frame
  }

  playAnim(petId, animKey, { loop = true, fps, onComplete } = {}) {
    const pet = CONFIG.pets.find(p => p.id === petId);
    if (!pet) return;
    this.petId = petId;
    const frames = getFramesByPrefix(pet.atlases, `${petId}-${animKey}-`);
    if (!frames.length) return;
    this._anim       = { frames, fps: fps ?? CONFIG.anim.idleFps };
    this._frame      = 0;
    this._elapsed    = 0;
    this._loop       = loop;
    this._onComplete = onComplete || null;
  }

  playAccessory(petId, accIndex) {
    const prefix = `${petId}-accessory${accIndex + 1}-`;
    const frames  = getFramesByPrefix(['texture-pet-accessories'], prefix);
    if (!frames.length) { this._accAnim = null; return; }

    // Store all frames so we can sync to the pet's current frame in draw()
    this._accAnim = frames.map(f => getFrame(f.atlas, f.frame)).filter(Boolean);

    const pet = CONFIG.pets.find(p => p.id === petId);
    this._accTopShift = pet?.accessories?.[accIndex]?.topShift ?? 0;
  }

  stopAccessory() { this._accAnim = null; }

  update(dt) {
    if (!this._anim || this.paused) return;
    this._elapsed += dt;
    const spf = 1 / this._anim.fps;
    while (this._elapsed >= spf) {
      this._elapsed -= spf;
      this._frame++;
      if (this._frame >= this._anim.frames.length) {
        if (this._loop) {
          this._frame = 0;
        } else {
          this._frame = this._anim.frames.length - 1;
          if (this._onComplete) { this._onComplete(); this._onComplete = null; }
        }
      }
    }
  }

  draw() {
    if (!this._anim) return;
    const f = this._anim.frames[this._frame];
    if (!f) return;

    const fd = getFrame(f.atlas, f.frame);
    if (!fd) return;

    const ctx   = this.ctx;
    const cx    = this.cx !== null ? this.cx : this.canvas.width  / 2;
    const cy    = this.cy !== null ? this.cy : this.canvas.height * 0.42;
    const scale = this.scale;

    // Draw the pet frame using spriteSourceSize anchoring so all frames
    // stay registered to the same pivot point (0.5, 0.5 of sourceSize).
    _drawAnchored(ctx, fd, cx, cy, scale);

    // Draw accessory: use settled last frame, nudge vertically by the pet
    // frame's own sss.y so the accessory tracks the head's idle micro-movement.
    if (this._accAnim?.length) {
      const afd = this._accAnim[this._accAnim.length - 1];
      const petSssY = fd.spriteSourceSize?.y ?? 0;
      const petSssX = fd.spriteSourceSize?.x ?? 0;
      if (afd) _drawAccessoryAnchored(ctx, afd, fd, cx, cy, scale, this._accTopShift || 0, petSssY * scale, -petSssX * scale);
    }
  }

  getBounds() {
    if (!this._anim) return null;
    const f  = this._anim.frames[this._frame];
    if (!f) return null;
    const fd = getFrame(f.atlas, f.frame);
    if (!fd) return null;
    const cx = this.cx !== null ? this.cx : this.canvas.width  / 2;
    const cy = this.cy !== null ? this.cy : this.canvas.height * 0.42;
    const w  = fd.naturalW * this.scale;
    const h  = fd.naturalH * this.scale;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
}

// ── Drawing helpers ───────────────────────────────────────────────────────

/**
 * Draw a frame so the pivot (0.5, 0.5) of its sourceSize sits at (cx, cy).
 * The spriteSourceSize offset keeps trimmed frames registered correctly.
 */
function _drawAnchored(ctx, fd, cx, cy, scale) {
  const { image, frame, rotated, naturalW, naturalH, atlasW, atlasH, sourceSize } = fd;
  const dw = naturalW * scale;
  const dh = naturalH * scale;

  const dx = cx - dw / 2;

  const effectiveH = Math.max(sourceSize.w, sourceSize.h);
  const cyFloor    = cy + (effectiveH / 2) * scale;
  const dy         = cyFloor - dh;

  if (!rotated) {
    ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, dx, dy, dw, dh);
    return;
  }

  ctx.save();
  ctx.translate(dx + dw / 2, dy + dh / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(image, frame.x, frame.y, atlasW, atlasH,
    -dh / 2, -dw / 2, dh, dw);
  ctx.restore();
}

/**
 * Draw the accessory by stacking its source canvas directly on top of the pet's
 * source canvas. Both are centered at cx on the x-axis. The accessory source
 * top aligns with the pet source top, pushing the accessory above the pet body.
 *
 * Formula:
 *   accDy = cy - (petSrcH / 2) * scale   ← top of pet source canvas in screen space
 *         - (accSrcH / 2) * scale         ← center the acc source canvas above that
 *         + accSss.y * scale              ← apply the acc's own spriteSourceSize.y
 */
function _drawAccessoryAnchored(ctx, afd, petFd, cx, cy, scale, topShift = 0, petSssYOffset = 0, petSssXOffset = 0) {
  const petSrcH = Math.max(petFd.sourceSize.w, petFd.sourceSize.h);
  const accSrcH = afd.sourceSize.h;
  const accSrcW = afd.sourceSize.w;
  const sss     = afd.spriteSourceSize;

  const dw = afd.naturalW * scale;
  const dh = afd.naturalH * scale;
  const dx = cx - (accSrcW / 2) * scale + sss.x * scale + petSssXOffset;
  const dy = cy
    - (petSrcH / 2) * scale
    - (accSrcH / 2) * scale
    + sss.y * scale
    - topShift * scale
    + petSssYOffset;

  if (!afd.rotated) {
    ctx.drawImage(afd.image, afd.frame.x, afd.frame.y, afd.frame.w, afd.frame.h,
      dx, dy, dw, dh);
    return;
  }

  ctx.save();
  ctx.translate(dx + dw / 2, dy + dh / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(afd.image, afd.frame.x, afd.frame.y, afd.atlasW, afd.atlasH,
    -dh / 2, -dw / 2, dh, dw);
  ctx.restore();
}
