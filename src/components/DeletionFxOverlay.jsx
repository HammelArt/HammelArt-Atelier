import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { buildForkedBolt } from "../utils/deletionFx";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function easeOutCubic(t) {
  const x = clamp(t, 0, 1);
  return 1 - Math.pow(1 - x, 3);
}

function easeInCubic(t) {
  const x = clamp(t, 0, 1);
  return x * x * x;
}

const smokeSpriteCache = new Map();

function getSmokeSprite(accentRgb) {
  let cached = smokeSpriteCache.get(accentRgb);
  if (cached) return cached;
  const sz = 64;
  const c = document.createElement("canvas");
  c.width = sz;
  c.height = sz;
  const sctx = c.getContext("2d");
  if (sctx) {
    const r = sz * 0.5;
    const grad = sctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, "rgba(218, 226, 242, 0.92)");
    grad.addColorStop(0.5, `rgba(${accentRgb}, 0.34)`);
    grad.addColorStop(1, "rgba(18, 18, 28, 0)");
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, sz, sz);
  }
  smokeSpriteCache.set(accentRgb, c);
  return c;
}

function strokeBoltPath(ctx, segs, wantDepth) {
  ctx.beginPath();
  let drew = false;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.depth !== wantDepth) continue;
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    drew = true;
  }
  if (drew) ctx.stroke();
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rad);
  } else {
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }
}

function drawTargetSnapshot(ctx, target, x, y, w, h, radius) {
  ctx.save();
  roundedRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  let drew = false;
  if (target.imgEl) {
    try {
      const iw = target.imgEl.naturalWidth || target.imgEl.videoWidth || 0;
      const ih = target.imgEl.naturalHeight || target.imgEl.videoHeight || 0;
      if (iw > 0 && ih > 0) {
        // Replicate CSS object-fit: cover cleanly so scaled tiles match crisp framing
        const srcAsp = iw / ih;
        const dstAsp = w / Math.max(1, h);
        let sx = 0;
        let sy = 0;
        let sw = iw;
        let sh = ih;
        if (Math.abs(srcAsp - dstAsp) > 0.02) {
          if (srcAsp > dstAsp) {
            sw = ih * dstAsp;
            sx = (iw - sw) * 0.5;
          } else {
            sh = iw / dstAsp;
            sy = (ih - sh) * 0.5;
          }
        }
        ctx.drawImage(target.imgEl, sx, sy, sw, sh, x, y, w, h);
        drew = true;
      }
    } catch {}
  }
  if (!drew) {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#1c1928");
    g.addColorStop(1, "#0f0d16");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

function drawSparkleStar(ctx, x, y, r, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = (i * Math.PI) / 4;
    const rad = i % 2 === 0 ? r : r * 0.28;
    const px = Math.cos(ang) * rad;
    const py = Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Pre-renders a crisp low-res working buffer + smooth procedural burn map
 * so the Ember Burn effect can eat inward across irregular noise contours at 120fps.
 */
function prepareEmberBuffer(target) {
  const maxDim = 200;
  const aspect = target.w / Math.max(1, target.h);
  const bw = Math.max(40, Math.round(aspect >= 1 ? maxDim : maxDim * aspect));
  const bh = Math.max(40, Math.round(aspect >= 1 ? maxDim / aspect : maxDim));

  const off = document.createElement("canvas");
  off.width = bw;
  off.height = bh;
  const octx = off.getContext("2d");
  if (!octx) return null;

  drawTargetSnapshot(
    octx,
    target,
    0,
    0,
    bw,
    bh,
    Math.max(2, (target.radius * bw) / Math.max(1, target.w))
  );

  let origData;
  try {
    origData = octx.getImageData(0, 0, bw, bh);
  } catch {
    return null;
  }

  // Smooth bilinear 2D value noise combined with radial inward edge burn bias
  const gs = 18;
  const grid = new Float32Array(gs * gs);
  for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
  const sampleNoise = (nx, ny) => {
    const gx = nx * (gs - 1);
    const gy = ny * (gs - 1);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(gs - 1, x0 + 1);
    const y1 = Math.min(gs - 1, y0 + 1);
    const fx = gx - x0;
    const fy = gy - y0;
    const a = grid[y0 * gs + x0];
    const b = grid[y0 * gs + x1];
    const c = grid[y1 * gs + x0];
    const d = grid[y1 * gs + x1];
    const top = a + (b - a) * fx;
    const bot = c + (d - c) * fx;
    return top + (bot - top) * fy;
  };

  // Pick 2 asymmetric ignition spots so the burn curls naturally instead of shrinking like a box
  const h1x = 0.25 + Math.random() * 0.5;
  const h1y = 0.2 + Math.random() * 0.6;
  const burnMap = new Float32Array(bw * bh);
  for (let py = 0; py < bh; py++) {
    const ny = py / Math.max(1, bh - 1);
    for (let px = 0; px < bw; px++) {
      const nx = px / Math.max(1, bw - 1);
      const edgeDist = Math.min(nx, 1 - nx, ny, 1 - ny) * 2.0; // 0 on border -> 1 center
      const spotDist = Math.min(1, Math.hypot(nx - h1x, ny - h1y) * 1.15);
      const n = sampleNoise(nx, ny) * 0.58 + sampleNoise((nx * 2) % 1, (ny * 2) % 1) * 0.22;
      burnMap[py * bw + px] = clamp(edgeDist * 0.42 + spotDist * 0.34 + n * 0.52 - 0.12, 0, 1);
    }
  }

  const outData = octx.createImageData(bw, bh);
  return { off, octx, bw, bh, origData: origData.data, outData, burnMap };
}

function createJobState(mode, target, prevTarget, accentRgb, delayMs) {
  const job = {
    mode,
    target,
    delayMs,
    durationMs: mode === "zap" ? 250 : mode === "ember" ? 560 : mode === "lightning" ? 540 : 410,
    particles: [],
  };

  if (mode === "zap") {
    for (let i = 0; i < 16; i++) {
      const ang = (Math.random() - 0.5) * Math.PI * 2;
      const spd = 90 + Math.random() * 210;
      job.particles.push({
        x: target.cx + (Math.random() - 0.5) * target.w * 0.65,
        y: target.cy + (Math.random() - 0.5) * target.h * 0.25,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd * 0.45,
        r: 1.5 + Math.random() * 2.4,
        hot: Math.random() < 0.45,
      });
    }
  } else if (mode === "ember") {
    job.ember = prepareEmberBuffer(target);
    for (let i = 0; i < 26; i++) {
      job.particles.push({
        x: target.x + Math.random() * target.w,
        y: target.y + Math.random() * target.h,
        vx: (Math.random() - 0.5) * 44,
        vy: -(48 + Math.random() * 96),
        r: 1.2 + Math.random() * 2.4,
        bornAt: Math.random() * 0.55,
        life: 0.35 + Math.random() * 0.35,
      });
    }
  } else if (mode === "lightning") {
    const startX = prevTarget
      ? prevTarget.cx
      : clamp(target.cx + (Math.random() - 0.5) * 260, 40, (window.innerWidth || 1280) - 40);
    const startY = prevTarget ? prevTarget.cy : -12;
    job.bolts = buildForkedBolt(startX, startY, target.cx, target.cy, 0);
    job.boltsAlt = buildForkedBolt(startX, startY, target.cx, target.cy, 0);
    for (let i = 0; i < 10; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.random() * Math.min(target.w, target.h) * 0.24;
      job.particles.push({
        x: target.cx + Math.cos(ang) * dist,
        y: target.cy + Math.sin(ang) * dist,
        vx: Math.cos(ang) * (14 + Math.random() * 24),
        vy: -16 - Math.random() * 26 + Math.sin(ang) * 10,
        r0: 14 + Math.random() * 18,
        rGrow: 18 + Math.random() * 22,
      });
    }
  } else if (mode === "poof") {
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const spd = 85 + Math.random() * 145;
      job.particles.push({
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        r: 4 + Math.random() * 6,
        rot: Math.random() * Math.PI,
        rotSpd: (Math.random() - 0.5) * 8,
        palette: i % 3 === 0 ? "#ffffff" : i % 3 === 1 ? "#fde68a" : `rgb(${accentRgb})`,
      });
    }
  }

  return job;
}

function drawJobFrame(ctx, job, elapsedMs, accentRgb) {
  const { mode, target, durationMs } = job;
  const localMs = elapsedMs - job.delayMs;
  if (localMs < 0) {
    // Hold visible snapshot cleanly until wave stagger reaches this tile
    drawTargetSnapshot(ctx, target, target.x, target.y, target.w, target.h, target.radius);
    return;
  }
  const p = clamp(localMs / durationMs, 0, 1);

  if (mode === "zap") {
    if (p < 0.38) {
      const k = p / 0.38;
      const squashY = 1 - k * 0.28;
      const hNow = target.h * squashY;
      const yNow = target.cy - hNow * 0.5;
      drawTargetSnapshot(ctx, target, target.x, yNow, target.w, hNow, target.radius * squashY);

      ctx.save();
      roundedRectPath(ctx, target.x, yNow, target.w, hNow, target.radius * squashY);
      ctx.clip();
      ctx.fillStyle = `rgba(${accentRgb}, ${(0.28 + 0.35 * k).toFixed(3)})`;
      ctx.fillRect(target.x, yNow, target.w, hNow);
      const scanY = yNow + hNow * (0.15 + 0.7 * k);
      const grad = ctx.createLinearGradient(target.x, scanY - 12, target.x, scanY + 12);
      grad.addColorStop(0, `rgba(${accentRgb}, 0)`);
      grad.addColorStop(0.5, "rgba(255, 255, 255, 0.95)");
      grad.addColorStop(1, `rgba(${accentRgb}, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(target.x, scanY - 12, target.w, 24);
      ctx.restore();
    } else {
      const k = clamp((p - 0.38) / 0.62, 0, 1);
      const e = easeInCubic(k);
      const lineW = target.w * (1 - e * 0.88);
      const lineH = Math.max(1.5, target.h * 0.72 * (1 - easeOutCubic(Math.min(1, k * 1.35))));
      const xNow = target.cx - lineW * 0.5;
      const yNow = target.cy - lineH * 0.5;

      if (k < 0.55) {
        ctx.save();
        ctx.globalAlpha = 1 - k / 0.55;
        drawTargetSnapshot(ctx, target, xNow, yNow, lineW, lineH, 3);
        ctx.restore();
      }

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";

      // Layered additive plasma glow (zero shadowBlur for 120fps multi-tile batches)
      ctx.strokeStyle = `rgba(${accentRgb}, ${(0.24 * (1 - e)).toFixed(3)})`;
      ctx.lineWidth = Math.max(4, 16 * (1 - e));
      ctx.beginPath();
      ctx.moveTo(target.cx - lineW * 0.58, target.cy);
      ctx.lineTo(target.cx + lineW * 0.58, target.cy);
      ctx.stroke();

      ctx.strokeStyle = `rgba(${accentRgb}, ${(0.78 * (1 - e)).toFixed(3)})`;
      ctx.lineWidth = Math.max(2, 6.5 * (1 - e));
      ctx.stroke();

      ctx.strokeStyle = `rgba(255, 255, 255, ${(0.95 * (1 - e)).toFixed(3)})`;
      ctx.lineWidth = Math.max(1, 2.4 * (1 - e));
      ctx.stroke();

      for (let i = 0; i < job.particles.length; i++) {
        const pt = job.particles[i];
        const dt = k * 0.2;
        const px = pt.x + pt.vx * dt;
        const py = pt.y + pt.vy * dt;
        ctx.fillStyle = pt.hot
          ? `rgba(255, 255, 255, ${(1 - e).toFixed(3)})`
          : `rgba(${accentRgb}, ${(0.9 * (1 - e)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(px, py, pt.r * (1 - e * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    return;
  }

  if (mode === "ember") {
    if (job.ember) {
      const { off, octx, bw, bh, origData, outData, burnMap } = job.ember;
      const dst = outData.data;
      const thresh = p * 1.18 - 0.08;
      const charW = 0.075;
      const emberW = 0.09;
      for (let idx = 0, px = 0; px < burnMap.length; px++, idx += 4) {
        const aOrig = origData[idx + 3];
        if (aOrig === 0) {
          dst[idx + 3] = 0;
          continue;
        }
        const bVal = burnMap[px];
        if (bVal < thresh) {
          dst[idx + 3] = 0;
        } else if (bVal < thresh + charW) {
          dst[idx] = 28;
          dst[idx + 1] = 14;
          dst[idx + 2] = 10;
          dst[idx + 3] = Math.round(aOrig * (1 - p * 0.25));
        } else if (bVal < thresh + charW + emberW) {
          const hot = 1 - (bVal - (thresh + charW)) / emberW;
          dst[idx] = Math.min(255, Math.round(255));
          dst[idx + 1] = Math.min(255, Math.round(70 + hot * 175));
          dst[idx + 2] = Math.min(255, Math.round(15 + hot * 130));
          dst[idx + 3] = aOrig;
        } else {
          dst[idx] = origData[idx];
          dst[idx + 1] = origData[idx + 1];
          dst[idx + 2] = origData[idx + 2];
          dst[idx + 3] = aOrig;
        }
      }
      octx.putImageData(outData, 0, 0);
      ctx.drawImage(off, target.x, target.y, target.w, target.h);
    } else {
      ctx.save();
      ctx.globalAlpha = 1 - easeInCubic(p);
      drawTargetSnapshot(ctx, target, target.x, target.y, target.w, target.h, target.radius);
      ctx.restore();
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < job.particles.length; i++) {
      const sp = job.particles[i];
      const lp = (p - sp.bornAt) / sp.life;
      if (lp <= 0 || lp >= 1) continue;
      const px = sp.x + sp.vx * lp + Math.sin(lp * 9 + i) * 5;
      const py = sp.y + sp.vy * lp;
      const op = Math.sin(lp * Math.PI);
      ctx.fillStyle = i % 3 === 0 ? `rgba(255, 240, 175, ${op.toFixed(3)})` : `rgba(255, 115, 30, ${op.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px, py, sp.r * (1 - lp * 0.45), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  if (mode === "lightning") {
    // 0..0.24 impact flash + micro-shake; 0.24..0.55 card vaporize; 0.20..1.0 ozone smoke puff
    const shaking = p < 0.26;
    const jx = shaking ? (Math.random() - 0.5) * 11 * (1 - p / 0.26) : 0;
    const jy = shaking ? (Math.random() - 0.5) * 9 * (1 - p / 0.26) : 0;

    if (p < 0.54) {
      const vap = clamp((p - 0.22) / 0.32, 0, 1);
      const sc = 1 - easeInCubic(vap) * 0.35;
      const wNow = target.w * sc;
      const hNow = target.h * sc;
      const xNow = target.cx + jx - wNow * 0.5;
      const yNow = target.cy + jy - hNow * 0.5;

      ctx.save();
      ctx.globalAlpha = 1 - easeOutCubic(vap);
      drawTargetSnapshot(ctx, target, xNow, yNow, wNow, hNow, target.radius);

      // Blinding white/plasma flash at impact moment
      const flash = p < 0.24 ? Math.sin((p / 0.24) * Math.PI) : (1 - vap) * 0.45;
      if (flash > 0.02) {
        roundedRectPath(ctx, xNow, yNow, wNow, hNow, target.radius);
        ctx.fillStyle = `rgba(255, 255, 255, ${clamp(flash * 0.88, 0, 0.92).toFixed(3)})`;
        ctx.fill();
      }
      ctx.restore();
    }

    // Smoke / ozone cloud radiating after strike (cached sprite drawImage = zero gradient allocations)
    if (p > 0.16) {
      const sp = clamp((p - 0.16) / 0.84, 0, 1);
      const fade = Math.pow(1 - sp, 1.35) * 0.44;
      const sprite = getSmokeSprite(accentRgb);
      ctx.save();
      ctx.globalAlpha = clamp(fade, 0, 1);
      for (let i = 0; i < job.particles.length; i++) {
        const pt = job.particles[i];
        const px = pt.x + pt.vx * sp;
        const py = pt.y + pt.vy * sp;
        const rad = pt.r0 + pt.rGrow * easeOutCubic(sp);
        ctx.drawImage(sprite, px - rad, py - rad, rad * 2, rad * 2);
      }
      ctx.restore();
    }

    // Lightning bolt flash (batched additive glow paths — 3 passes total, 0 shadowBlur!)
    if (p < 0.34) {
      const bProg = p / 0.34;
      const flicker = Math.sin(bProg * Math.PI) * (Math.random() < 0.3 ? 0.55 : 1);
      const bolts = bProg < 0.5 ? job.bolts : job.boltsAlt;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";

      ctx.strokeStyle = `rgba(${accentRgb}, ${(0.2 * flicker).toFixed(3)})`;
      ctx.lineWidth = 11;
      strokeBoltPath(ctx, bolts, 0);
      ctx.lineWidth = 5;
      strokeBoltPath(ctx, bolts, 1);

      ctx.strokeStyle = `rgba(${accentRgb}, ${(0.82 * flicker).toFixed(3)})`;
      ctx.lineWidth = 4.4;
      strokeBoltPath(ctx, bolts, 0);
      ctx.lineWidth = 2.0;
      strokeBoltPath(ctx, bolts, 1);

      ctx.strokeStyle = `rgba(255, 255, 255, ${(0.98 * flicker).toFixed(3)})`;
      ctx.lineWidth = 1.9;
      strokeBoltPath(ctx, bolts, 0);
      ctx.lineWidth = 0.9;
      strokeBoltPath(ctx, bolts, 1);
      ctx.restore();
    }
    return;
  }

  if (mode === "poof") {
    // Phase 1: snappy pop-shrink to 0px center (0..0.46)
    if (p < 0.46) {
      const k = p / 0.46;
      const sc = k < 0.16 ? 1 + (k / 0.16) * 0.05 : 1.05 * (1 - easeInCubic((k - 0.16) / 0.84));
      const rot = k * 0.28;
      ctx.save();
      ctx.translate(target.cx, target.cy);
      ctx.rotate(rot);
      ctx.scale(Math.max(0.005, sc), Math.max(0.005, sc));
      ctx.globalAlpha = clamp(1.25 - k, 0, 1);
      drawTargetSnapshot(
        ctx,
        target,
        -target.w * 0.5,
        -target.h * 0.5,
        target.w,
        target.h,
        target.radius
      );
      if (k > 0.45) {
        const glow = (k - 0.45) / 0.55;
        roundedRectPath(ctx, -target.w * 0.5, -target.h * 0.5, target.w, target.h, target.radius);
        ctx.fillStyle = `rgba(255, 255, 255, ${(glow * 0.72).toFixed(3)})`;
        ctx.fill();
      }
      ctx.restore();
    }

    // Phase 2: pinpoint flash + 4-point sparkle burst (0.38..1.0)
    if (p >= 0.36) {
      const bp = clamp((p - 0.36) / 0.64, 0, 1);
      const flashOp = bp < 0.25 ? 1 : 1 - (bp - 0.25) / 0.75;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      if (flashOp > 0.02) {
        const rCore = 8 + easeOutCubic(bp) * 34;
        const grad = ctx.createRadialGradient(target.cx, target.cy, 0, target.cx, target.cy, rCore);
        grad.addColorStop(0, `rgba(255, 255, 255, ${(flashOp * 0.92).toFixed(3)})`);
        grad.addColorStop(0.45, `rgba(${accentRgb}, ${(flashOp * 0.55).toFixed(3)})`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(target.cx, target.cy, rCore, 0, Math.PI * 2);
        ctx.fill();
      }

      const travel = easeOutCubic(bp) * 0.42;
      const spFade = Math.sin(bp * Math.PI);
      for (let i = 0; i < job.particles.length; i++) {
        const sp = job.particles[i];
        const px = target.cx + sp.vx * travel;
        const py = target.cy + sp.vy * travel;
        ctx.globalAlpha = clamp(spFade * 1.15, 0, 1);
        ctx.fillStyle = sp.palette;
        drawSparkleStar(ctx, px, py, sp.r * (1 - bp * 0.45), sp.rot + sp.rotSpd * bp);
      }
      ctx.restore();
    }
  }
}

/**
 * Full-viewport Canvas2D FX Overlay orchestrating Zap, Ember Burn,
 * Chain-Lightning Strike + Vapor Smoke, and Magic Sparkle Poof animations.
 */
const DeletionFxOverlay = forwardRef(function DeletionFxOverlay(_, ref) {
  const canvasRef = useRef(null);
  const batchesRef = useRef([]);
  const rafRef = useRef(0);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      for (let i = 0; i < batchesRef.current.length; i++) {
        batchesRef.current[i].resolve?.();
      }
      batchesRef.current = [];
    };
  }, []);

  const ensureLoop = () => {
    if (rafRef.current) return;

    const tick = (now) => {
      const canvas = canvasRef.current;
      const batches = batchesRef.current;
      if (!canvas || batches.length === 0) {
        if (canvas) {
          const ctx = canvas.getContext("2d");
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
        rafRef.current = 0;
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 800;
      const needW = Math.round(vw * dpr);
      const needH = Math.round(vh * dpr);
      if (canvas.width !== needW || canvas.height !== needH) {
        canvas.width = needW;
        canvas.height = needH;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafRef.current = 0;
        return;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, vw, vh);

      const remaining = [];
      for (let bIdx = 0; bIdx < batches.length; bIdx++) {
        const batch = batches[bIdx];
        const elapsed = now - batch.startTs;

        if (!batch.arrived && batch.onArrivePulse && elapsed >= 135) {
          batch.arrived = true;
          batch.onArrivePulse();
        }

        if (elapsed >= batch.totalDurationMs) {
          batch.resolve?.();
          continue;
        }

        for (let j = 0; j < batch.jobs.length; j++) {
          drawJobFrame(ctx, batch.jobs[j], elapsed, batch.accentRgb);
        }
        remaining.push(batch);
      }

      batchesRef.current = remaining;
      if (remaining.length > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, vw, vh);
        rafRef.current = 0;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  };

  useImperativeHandle(ref, () => ({
    playFx({ mode = "ember", targets = [], accentRgb = "168, 85, 247", onArrivePulse } = {}) {
      const valid = (targets || []).filter(Boolean);
      if (mode === "instant" || valid.length === 0) {
        onArrivePulse?.();
        return Promise.resolve();
      }

      // Sort reading-order (top-to-bottom, left-to-right) so waves & chain-lightning look organic
      const sorted = [...valid].sort((a, b) => {
        if (Math.abs(a.cy - b.cy) > 38) return a.cy - b.cy;
        return a.cx - b.cx;
      });
      const capped = sorted.slice(0, 20);
      const maxWaveSpan =
        mode === "zap" ? 90 : mode === "lightning" ? 300 : mode === "poof" ? 210 : 250;
      const stepDelay = capped.length > 1 ? Math.min(48, maxWaveSpan / (capped.length - 1)) : 0;

      const jobs = capped.map((t, idx) =>
        createJobState(
          mode,
          t,
          idx > 0 ? capped[idx - 1] : null,
          accentRgb,
          idx * stepDelay
        )
      );
      const totalDurationMs = Math.max(...jobs.map((j) => j.delayMs + j.durationMs)) + 16;

      return new Promise((resolve) => {
        batchesRef.current.push({
          startTs: performance.now(),
          totalDurationMs,
          accentRgb,
          jobs,
          onArrivePulse,
          arrived: false,
          resolve,
        });
        ensureLoop();
      });
    },
  }));

  return <canvas ref={canvasRef} className="hm-delete-fx-canvas" aria-hidden="true" />;
});

export default DeletionFxOverlay;
