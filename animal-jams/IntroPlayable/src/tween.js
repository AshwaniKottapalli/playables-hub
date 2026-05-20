const _active = [];

export const Ease = {
  linear:         t => t,
  easeOutQuad:    t => 1 - (1 - t) ** 2,
  easeInQuad:     t => t * t,
  easeOutCubic:   t => 1 - (1 - t) ** 3,
  easeInCubic:    t => t * t * t,
  easeInOutCubic: t => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2,
  easeOutBack:    t => { const c = 1.70158, c3 = c + 1; return 1 + c3 * (t - 1) ** 3 + c * (t - 1) ** 2; },
  easeOutElastic: t => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
  },
  easeInBack: t => { const c = 1.70158, c3 = c + 1; return c3 * t ** 3 - c * t ** 2; },
};

/**
 * Animate properties of `target` toward `toProps` over `duration` seconds.
 * Returns a handle: { cancel(), promise }.
 * `onComplete` fires once when the tween finishes naturally.
 */
export function tween(target, toProps, duration, ease = Ease.easeOutCubic, onComplete) {
  const from = {};
  for (const k in toProps) from[k] = target[k] ?? 0;

  let elapsed = 0;
  let cancelled = false;
  let resolvePromise;
  const promise = new Promise(r => { resolvePromise = r; });

  const entry = {
    update(dt) {
      if (cancelled) { resolvePromise(); return true; }
      elapsed = Math.min(elapsed + dt, duration);
      const raw = duration > 0 ? elapsed / duration : 1;
      const t = ease(raw);
      for (const k in toProps) target[k] = from[k] + (toProps[k] - from[k]) * t;
      if (raw >= 1) {
        if (onComplete) onComplete();
        resolvePromise();
        return true; // remove from active list
      }
      return false;
    },
    cancel() { cancelled = true; },
    promise,
  };

  _active.push(entry);
  return entry;
}

/** Call once per frame from the main loop BEFORE any rendering. */
export function updateTweens(dt) {
  for (let i = _active.length - 1; i >= 0; i--) {
    if (_active[i].update(dt)) _active.splice(i, 1);
  }
}

/** Wait for a number of seconds (returns a promise resolved after `secs`). */
export function wait(secs) {
  const dummy = { _t: 0 };
  return tween(dummy, { _t: 1 }, secs, Ease.linear).promise;
}
