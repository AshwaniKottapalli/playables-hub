export class ParticleSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
  }

  emit(x, y, count, opts = {}) {
    const {
      kind = 'sparkle',
      color = '#fff',
      size = 12,
      speed = 400,
      gravity = 800,
      lifetime = 1.2,
      upBias = 0.6,
      spread = Math.PI,
    } = opts;

    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread + (upBias - 0.5) * Math.PI;
      const spd = speed * (0.5 + Math.random() * 0.5);
      this.particles.push({
        kind,
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        size: size * (0.6 + Math.random() * 0.8),
        color: kind === 'confetti' ? CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)] : color,
        life: lifetime * (0.7 + Math.random() * 0.6),
        maxLife: lifetime,
        rot: Math.random() * Math.PI * 2,
        rotSpd: (Math.random() - 0.5) * 10,
        gravity,
      });
    }
  }

  burst(x, y) {
    this.emit(x, y, 20, { kind: 'confetti', speed: 600, gravity: 1200, lifetime: 1.5, spread: Math.PI * 2 });
    this.emit(x, y, 12, { kind: 'sparkle', color: '#ffe066', speed: 300, size: 16, lifetime: 0.9, upBias: 0.8 });
  }

  update(dt) {
    this.particles = this.particles.filter(p => p.life > 0);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.rot += p.rotSpd * dt;
      p.life -= dt;
    }
  }

  draw() {
    const ctx = this.ctx;
    ctx.save();
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      if (p.kind === 'sparkle') {
        drawStar(ctx, p.x, p.y, p.size, p.color, p.rot);
      } else {
        drawRect(ctx, p.x, p.y, p.size, p.size * 0.5, p.color, p.rot);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function drawStar(ctx, x, y, r, color, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const ra = a + (2 * Math.PI) / 5;
    i === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.lineTo(Math.cos(ra) * r * 0.4, Math.sin(ra) * r * 0.4);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRect(ctx, x, y, w, h, color, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

const CONFETTI_COLORS = ['#ff6b6b', '#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#ffe66d', '#a8dadc', '#e9c46a'];
