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

  playAccessory(petId, accIndex, colorVariant = 0) {
    const prefix = `${petId}-accessory${accIndex + 1}-`;
    const frames  = getFramesByPrefix(['texture-pet-accessories'], prefix);
    if (!frames.length) { this._accAnim = null; return; }

    this._accAnim = frames.map(f => getFrame(f.atlas, f.frame)).filter(Boolean);

    const pet = CONFIG.pets.find(p => p.id === petId);
    const acc = pet?.accessories?.[accIndex];
    const vi  = colorVariant;
    this._accHeadShift = pet?.headOffsets?.[vi] ?? 0;
    this._accTopShift  = Array.isArray(acc?.topShift)  ? (acc.topShift[vi]  ?? 0) : (acc?.topShift  ?? 0);
    this._accSideShift = Array.isArray(acc?.sideShift) ? (acc.sideShift[vi] ?? 0) : (acc?.sideShift ?? 0);
  }

  stopAccessory() { this._accAnim = null; }

  // headOffsets: array of {dx, dy} per idle frame (from head-offsets.json)
  setHeadOffsets(offsets) { this._headOffsets = offsets || null; }

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

    if (this._accAnim?.length) {
      const afd = this._accAnim[this._accAnim.length - 1];
      // Use centroid-based head offsets if available, otherwise fall back to sss nudge
      let extraX = 0, extraY = 0;
      if (this._headOffsets?.[this._frame]) {
        extraX = -this._headOffsets[this._frame].dx * scale;
        extraY =  this._headOffsets[this._frame].dy * scale;
      } else {
        extraY = (fd.spriteSourceSize?.y ?? 0) * scale;
        extraX = -(fd.spriteSourceSize?.x ?? 0) * scale;
      }
      if (afd) _drawAccessoryAnchored(ctx, afd, fd, cx, cy, scale, this._accHeadShift || 0, this._accTopShift || 0, extraY, extraX, this._accSideShift || 0);
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

  // Anchor horizontally to sourceSize.w so content always sits at the same
  // position within the logical canvas — eliminates frame.w trim variation drift.
  const sss = fd.spriteSourceSize;
  const dx = cx - (sourceSize.w / 2) * scale + sss.x * scale;

  const effectiveH = sourceSize.h;
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
function _drawAccessoryAnchored(ctx, afd, petFd, cx, cy, scale, headOffset = 0, topShift = 0, petSssYOffset = 0, petSssXOffset = 0, sideShift = 0) {
  const petSrcH = petFd.sourceSize.h;
  const accSrcH = afd.sourceSize.h;
  const accSrcW = afd.sourceSize.w;
  const sss     = afd.spriteSourceSize;

  const dw = afd.naturalW * scale;
  const dh = afd.naturalH * scale;
  const dx = cx - (accSrcW / 2) * scale + sss.x * scale + petSssXOffset + sideShift * scale;
  const dy = cy
    - (petSrcH / 2) * scale
    + headOffset * scale
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
