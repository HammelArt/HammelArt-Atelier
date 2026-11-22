/**
 * 2.5D Tabletop Photo Pile Physics Engine
 * ---------------------------------------
 * Rigid-sheet simulation with airborne flight, Z-gravity drop & micro-settle,
 * kinetic paper-on-paper sliding friction, Coulomb rest cutoff, and subtle
 * shear impulse transfer onto top underlying sheets when landing.
 */

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function getItemAspect(item) {
  if (!item) return 1;
  if (Number.isFinite(item.aspect_ratio) && item.aspect_ratio > 0) return item.aspect_ratio;
  if (Number.isFinite(item.aspect) && item.aspect > 0) return item.aspect;
  if (item.width > 0 && item.height > 0) return item.width / item.height;
  return 1;
}

export function computePilePrintBox(
  item,
  stageW,
  stageH,
  printScalePct = 62,
  mattePx = 0,
  sizeScale = 1.0
) {
  const mat = clamp(Math.round(Number(mattePx) || 0), 0, 48);
  const scale = clamp(Number(printScalePct || 62) * (Number(sizeScale) || 1), 8, 130) * 0.01;
  const availW = Math.max(36, stageW * scale - mat * 2);
  const availH = Math.max(36, stageH * scale - mat * 2);
  const asp = getItemAspect(item);
  let innerW = availW;
  let innerH = innerW / asp;
  if (innerH > availH) {
    innerH = availH;
    innerW = innerH * asp;
  }
  const w = Math.max(48, Math.round(innerW) + mat * 2);
  const h = Math.max(48, Math.round(innerH) + mat * 2);
  return { w, h };
}

const ALL_8_DIRECTIONS = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"];

const DIR_VECTORS = {
  S: { x: 0, y: 1 },
  SE: { x: 0.78, y: 0.72 },
  E: { x: 1, y: 0 },
  NE: { x: 0.78, y: -0.72 },
  N: { x: 0, y: -1 },
  NW: { x: -0.78, y: -0.72 },
  W: { x: -1, y: 0 },
  SW: { x: -0.78, y: 0.72 },
};

function pickEntryDirection(throwFrom, lastDir) {
  let pool = ALL_8_DIRECTIONS;
  if (throwFrom === "bottom") pool = ["S", "SE", "SW"];
  else if (throwFrom === "top") pool = ["N", "NE", "NW"];
  else if (throwFrom === "sides") pool = ["E", "W", "NE", "SE", "NW", "SW"];

  const filtered = pool.filter((d) => d !== lastDir);
  return filtered[Math.floor(Math.random() * filtered.length)] || pool[0];
}

function randRange(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

/**
 * Spawns a newly thrown photo sheet off the chosen edge with physically targeted
 * launch momentum + airborne height + wrist spin so it lands around center.
 */
export function createThrownBody({
  uid,
  item,
  stageW,
  stageH,
  params,
  lastEdge = null,
  reverseBias = false,
}) {
  const matPx = params.paperBorder !== false ? clamp(Number(params.borderThickness ?? 14), 4, 42) : 0;
  const box = computePilePrintBox(item, stageW, stageH, params.printScale, matPx);
  let dir = pickEntryDirection(params.throwFrom || "random", lastEdge);
  if (reverseBias && lastEdge && DIR_VECTORS[lastEdge]) {
    const opp = Object.keys(DIR_VECTORS).find(
      (k) => DIR_VECTORS[k].x === -DIR_VECTORS[lastEdge].x && DIR_VECTORS[k].y === -DIR_VECTORS[lastEdge].y
    );
    if (opp) dir = opp;
  }
  const vec = DIR_VECTORS[dir] || DIR_VECTORS.S;

  const mess = clamp(Number(params.messiness ?? 55), 0, 100) * 0.01;
  const power = clamp(Number(params.throwPower ?? 62), 20, 100) * 0.01;

  // Hard canvas visibility guarantee: at most ~26% of image edge can extend off-screen
  const hardLimX = Math.max(24, stageW * 0.5 - box.w * 0.24);
  const hardLimY = Math.max(20, stageH * 0.5 - box.h * 0.24);

  // Mix natural center-showcase landings with sweeping canvas-covering & corner-kissing throws
  const spreadRoll = Math.random();
  const reachFraction =
    spreadRoll < 0.42
      ? randRange(0.08, 0.36) // central showcase cluster
      : spreadRoll < 0.84
      ? randRange(0.32, 0.78) // sweeping across open left/right/upper/lower table
      : randRange(0.76, 1.0); // bold toss gliding near edge/corner (smaller part crops cleanly)

  const messReach = 0.2 + 0.8 * mess;
  const maxSpanX = hardLimX * messReach;
  const maxSpanY = hardLimY * messReach;

  // Bias travel slightly across the table opposite the launch side so shots sweep naturally
  const crossTheta = randRange(0, Math.PI * 2);
  const crossRadius = reachFraction;
  const targetX = clamp(
    (Math.cos(crossTheta) * 0.72 - vec.x * 0.28) * maxSpanX * crossRadius +
      randRange(-0.18, 0.18) * maxSpanX,
    -hardLimX,
    hardLimX
  );
  const targetY = clamp(
    (Math.sin(crossTheta) * 0.72 - vec.y * 0.28) * maxSpanY * crossRadius +
      randRange(-0.18, 0.18) * maxSpanY,
    -hardLimY,
    hardLimY
  );

  // Launch start just outside the 8-directional table perimeter with lateral entry jitter
  const halfDiag = Math.hypot(box.w, box.h) * 0.58;
  const perpX = -vec.y;
  const perpY = vec.x;
  const sideJitter = randRange(-0.22, 0.22) * Math.min(stageW, stageH);
  const startX = vec.x * (stageW * 0.5 + halfDiag + 32) + perpX * sideJitter;
  const startY = vec.y * (stageH * 0.5 + halfDiag + 32) + perpY * sideJitter;

  // Airborne Z & crisp downward flick
  const startZ = randRange(54, 82);
  const vz = -startZ * randRange(0.45, 0.65);
  const gravity = 1520;
  const airTime = (vz + Math.sqrt(vz * vz + 2 * gravity * startZ)) / gravity;

  // Closed-form physical travel integral + natural throw force variance
  const kAir = 1.55;
  const kSlide = 4.3 + power * 2.9;
  const airReach = (1 - Math.exp(-kAir * airTime)) / kAir;
  const vTouchFrac = Math.exp(-kAir * airTime);
  const slideReach = (vTouchFrac / kSlide) * 0.88;
  const totalReach = Math.max(0.14, airReach + slideReach);

  // Slight varied toss vigor lets some glide just short and others skim across past center
  const forceVariance = randRange(0.86, 1.15);
  const dx = targetX - startX;
  const dy = targetY - startY;
  const vx = (dx / totalReach) * forceVariance;
  const vy = (dy / totalReach) * forceVariance;

  // Genuine free-spinning wrist flick! Starts counter-cocked and spins ~25-45deg across flight & skid
  const spinDir = Math.random() < 0.5 ? -1 : 1;
  const spinSpeed = spinDir * randRange(48, 155) * (0.3 + 0.75 * mess);
  const startAngle = randRange(-14, 14) * (0.2 + 0.8 * mess) - spinSpeed * 0.28;

  // Pitch during airborne phase aligned cleanly to launch vector
  const pitchX = vec.y * 13 + randRange(-4, 4);
  const pitchY = -vec.x * 13 + randRange(-4, 4);

  return {
    uid,
    item,
    edge: dir,
    w: box.w,
    h: box.h,
    x: startX,
    y: startY,
    z: startZ,
    vx,
    vy,
    vz,
    angle: startAngle,
    vAngle: spinSpeed,
    pitchX,
    pitchY,
    kAir,
    kSlide,
    touchedDown: false,
    settled: false,
    exiting: false,
    opacity: 1,
    dragging: false,
    sizeKey: "M",
    sizeScale: 1.0,
    tablePinned: false,
    permaPinned: false,
    tapeSeed: Math.floor(Math.random() * 10000),
  };
}

function rectsOverlapFactor(a, b) {
  const ax1 = a.x - a.w * 0.5;
  const ax2 = a.x + a.w * 0.5;
  const ay1 = a.y - a.h * 0.5;
  const ay2 = a.y + a.h * 0.5;
  const bx1 = b.x - b.w * 0.5;
  const bx2 = b.x + b.w * 0.5;
  const by1 = b.y - b.h * 0.5;
  const by2 = b.y + b.h * 0.5;
  const ox = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const oy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const minArea = Math.max(1, Math.min(a.w * a.h, b.w * b.h));
  return clamp((ox * oy) / minArea, 0, 1);
}

/**
 * Advances all bodies cleanly by dt seconds.
 * Mutates bodies in-place for zero GC allocation during 120fps rAF.
 * Returns { removedAny: boolean } when faded-out bottom sheets need pruning.
 */
export function stepTablePile(bodies, dt, { stageW, stageH, shearNudge = true }) {
  const safeDt = clamp(dt, 0.001, 0.045);
  let removedAny = false;
  const gravity = 1520;
  const halfW = stageW * 0.5;
  const halfH = stageH * 0.5;

  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];

    if (b.windDelay > 0) {
      b.windDelay -= safeDt;
      if (b.windDelay <= 0 && b.pendingGust) {
        const g = b.pendingGust;
        b.pendingGust = null;
        b.blownAway = true;
        b.blownElapsed = 0;
        b.settled = false;
        b.kAir = 0.28;
        b.kSlide = 0.45;
        b.vx = g.vx;
        b.vy = g.vy;
        b.vz = g.vz;
        b.vAngle = g.vAngle;
        b.pitchX = g.pitchX;
        b.pitchY = g.pitchY;
      }
      continue;
    }

    if (b.blownAway) {
      b.blownElapsed = (b.blownElapsed || 0) + safeDt;
      if (
        Math.abs(b.x) > halfW + b.w * 0.72 ||
        Math.abs(b.y) > halfH + b.h * 0.72 ||
        b.blownElapsed > 1.2
      ) {
        b.opacity = Math.max(0, b.opacity - safeDt / 0.22);
        if (b.opacity <= 0.004) removedAny = true;
      }
    } else if (b.exiting) {
      b.opacity = Math.max(0, b.opacity - safeDt / 0.85);
      if (b.opacity <= 0.004) {
        removedAny = true;
      }
    }

    if (b.dragging) continue;

    // 1. Vertical Z-axis drop & crisp touchdown settle (lighter lift while caught in a gust)
    const activeGravity = b.blownAway ? 920 : gravity;
    if (b.z > 0 || b.vz !== 0) {
      b.vz -= activeGravity * safeDt;
      b.z += b.vz * safeDt;

      if (b.z <= 0) {
        b.z = 0;
        if (!b.touchedDown && !b.blownAway) {
          b.touchedDown = true;

          // Physical shear nudge with randomized throw impact transferred into underlying sheets
          if (shearNudge && i > 0) {
            const topSpeed = Math.hypot(b.vx, b.vy);
            if (topSpeed > 30) {
              // Varied landing weight: occasional light brush (~0.55x) up to heavier slap (~2.2x)
              const hitStrength = 0.55 + Math.pow(Math.random(), 1.35) * 1.65;
              for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
                const under = bodies[j];
                if (!under || under.dragging || under.exiting || under.permaPinned) continue;
                const ov = rectsOverlapFactor(b, under);
                if (ov > 0.06) {
                  const depth = i - j;
                  const decay = depth === 1 ? 1.0 : depth === 2 ? 0.48 : 0.22;
                  const mult = ov * decay * hitStrength;
                  under.vx +=
                    (b.vx * 0.135 + (Math.random() - 0.5) * 0.032 * topSpeed) * mult;
                  under.vy +=
                    (b.vy * 0.13 + (Math.random() - 0.5) * 0.032 * topSpeed) * mult;
                  under.vAngle +=
                    (b.vAngle * 0.24 + (Math.random() - 0.5) * 34) * mult;
                  under.settled = false;
                }
              }
            }
          }
        }
        // Whisper-light paper bounce on crisp contact, then dead flat
        if (b.vz < -220) {
          b.vz = -b.vz * 0.09;
        } else {
          b.vz = 0;
        }
      }
    }

    // Smoothly flatten 3D wrist pitch onto desk as z shrinks
    const pitchTarget = b.z > 2 ? b.z * 0.12 : 0;
    const pitchFactor = Math.min(1, safeDt * 16);
    b.pitchX += (clamp(pitchTarget, -12, 12) * Math.sign(b.pitchX || 1) - b.pitchX) * pitchFactor;
    b.pitchY += (0 - b.pitchY) * pitchFactor;
    if (b.z === 0 && Math.abs(b.pitchX) < 0.08) b.pitchX = 0;

    // 2. Linear motion + air/tabletop sliding friction
    const speed = Math.hypot(b.vx, b.vy);
    const rotSpeed = Math.abs(b.vAngle);

    if (speed > 0.1 || rotSpeed > 0.05 || b.z > 0) {
      b.x += b.vx * safeDt;
      b.y += b.vy * safeDt;
      b.angle += b.vAngle * safeDt;

      const drag = b.z > 0 ? b.kAir : b.kSlide;
      const damp = Math.exp(-drag * safeDt);
      b.vx *= damp;
      b.vy *= damp;
      // Slightly looser rotational damping so prints spin gracefully as they glide across the pile
      b.vAngle *= Math.exp(-(b.z > 0 ? 1.2 : 4.5) * safeDt);

      // Gentle Coulomb static friction cutoff on the surface so cards actually halt cleanly
      if (b.z === 0) {
        const curSpd = Math.hypot(b.vx, b.vy);
        if (curSpd > 0) {
          const brake = 28 * safeDt;
          if (curSpd <= brake) {
            b.vx = 0;
            b.vy = 0;
          } else {
            const ratio = (curSpd - brake) / curSpd;
            b.vx *= ratio;
            b.vy *= ratio;
          }
        }
        const rotBrake = 16 * safeDt;
        if (Math.abs(b.vAngle) <= rotBrake) {
          b.vAngle = 0;
        } else {
          b.vAngle -= Math.sign(b.vAngle) * rotBrake;
        }
      }

      // Soft desk-edge cushion: allows smaller portion (~24%) to kiss/crop at screen edge without bouncing wind-blown cards back in
      if (b.touchedDown && !b.blownAway) {
        const limX = Math.max(24, halfW - b.w * 0.24);
        const limY = Math.max(20, halfH - b.h * 0.24);
        if (b.x > limX) {
          b.x = limX;
          b.vx = -Math.abs(b.vx) * 0.35;
        } else if (b.x < -limX) {
          b.x = -limX;
          b.vx = Math.abs(b.vx) * 0.35;
        }
        if (b.y > limY) {
          b.y = limY;
          b.vy = -Math.abs(b.vy) * 0.35;
        } else if (b.y < -limY) {
          b.y = -limY;
          b.vy = Math.abs(b.vy) * 0.35;
        }
      }

      if (b.z === 0 && Math.hypot(b.vx, b.vy) < 1.2 && Math.abs(b.vAngle) < 0.3) {
        b.vx = 0;
        b.vy = 0;
        b.vAngle = 0;
        b.settled = true;
      }
    } else if (!b.settled) {
      b.settled = true;
    }
  }

  return { removedAny };
}
