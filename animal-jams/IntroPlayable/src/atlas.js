const _atlases = {};

export async function loadAtlas(name) {
  if (_atlases[name]) return _atlases[name];

  const [jsonRes, img] = await Promise.all([
    fetch(`assets/${name}.json`).then(r => r.json()),
    loadImage(`assets/${name}.png`).catch(() => loadImage(`assets/${name}.jpeg`)),
  ]);

  _atlases[name] = { frames: jsonRes.frames, image: img };
  return _atlases[name];
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Returns frame metadata including correct display dimensions and source offsets.
 *
 * TexturePacker sprite sheets use a "trim" system:
 *   - sourceSize: the full logical canvas the sprite occupies (e.g. 163×244)
 *   - spriteSourceSize: where the trimmed pixels sit within that canvas (x, y, w, h)
 *   - frame: where the trimmed pixels live in the atlas image
 *
 * For correct rendering both the pet and any accessory overlay must be drawn
 * with their pivot (0.5, 0.5) of sourceSize anchored to the SAME world point.
 * That way spriteSourceSize offsets keep everything registered frame-to-frame.
 *
 * When rotated=true the sprite is stored 90° CW in the atlas.
 */
export function getFrame(atlasName, frameName) {
  const atlas = _atlases[atlasName];
  if (!atlas) return null;
  const f = atlas.frames[frameName];
  if (!f) return null;

  const rotated = f.rotated || false;
  const sourceSize = f.sourceSize || { w: f.frame.w, h: f.frame.h };
  const sss = f.spriteSourceSize || { x: 0, y: 0, w: f.frame.w, h: f.frame.h };
  const spriteSourceSize = sss;

  // Two TexturePacker conventions exist for rotated frames:
  //   Standard:      frame.w/h = atlas region dims (transposed from display)
  //   Original-dims: frame.w/h = display dims (same as sourceSize); atlas region is transposed
  // Detect by checking if frame dims match sourceSize.
  let naturalW, naturalH, atlasW, atlasH;
  if (rotated && f.frame.w === sourceSize.w && f.frame.h === sourceSize.h) {
    // Original-dims convention: frame reports display size, atlas is transposed
    naturalW = f.frame.w; naturalH = f.frame.h;
    atlasW   = f.frame.h; atlasH   = f.frame.w;
  } else if (rotated) {
    // Standard convention: frame reports atlas dims, display is transposed
    naturalW = f.frame.h; naturalH = f.frame.w;
    atlasW   = f.frame.w; atlasH   = f.frame.h;
  } else {
    naturalW = f.frame.w; naturalH = f.frame.h;
    atlasW   = f.frame.w; atlasH   = f.frame.h;
  }

  return {
    image: atlas.image,
    frame: f.frame,
    rotated,
    naturalW,
    naturalH,
    atlasW,
    atlasH,
    sourceSize,
    spriteSourceSize,
  };
}

/**
 * Draw a sprite frame at (dx, dy) with explicit render size (dw × dh).
 * dw/dh should be the NATURAL (unrotated) dimensions * scale.
 * Handles rotated frames transparently.
 */
export function drawFrame(ctx, atlasName, frameName, dx, dy, dw, dh) {
  const data = getFrame(atlasName, frameName);
  if (!data) return;
  const { image, frame, rotated, naturalW, naturalH, atlasW, atlasH } = data;

  const rw = dw ?? naturalW;
  const rh = dh ?? naturalH;

  if (!rotated) {
    ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, dx, dy, rw, rh);
    return;
  }

  // Sprite stored 90° CW — rotate context -90° (CCW) to undo it.
  // Use atlasW/atlasH (actual atlas region dims) for the source crop.
  ctx.save();
  ctx.translate(dx + rw / 2, dy + rh / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(image, frame.x, frame.y, atlasW, atlasH,
    -rh / 2, -rw / 2, rh, rw);
  ctx.restore();
}

/**
 * Returns all frames whose name starts with `prefix`, sorted numerically by trailing number.
 */
export function getFramesByPrefix(atlasNames, prefix) {
  const result = [];
  for (const name of atlasNames) {
    const atlas = _atlases[name];
    if (!atlas) continue;
    for (const key of Object.keys(atlas.frames)) {
      if (key.startsWith(prefix)) result.push({ atlas: name, frame: key });
    }
  }
  result.sort((a, b) => frameNum(a.frame) - frameNum(b.frame));
  return result;
}

function frameNum(name) {
  const m = name.match(/(\d+)(?:\.\w+)?$/);
  return m ? parseInt(m[1], 10) : 0;
}
