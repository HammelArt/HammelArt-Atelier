/**
 * Closed-System Slideshow Transition Registry
 * ------------------------------------------
 * Each style is completely self-contained: it declares its own defaultParams,
 * its own drawer UI control descriptors, and its own pure frame transform math.
 * Adding, editing, or removing a style here never leaks parameters or side effects
 * into any other style.
 */

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function easeCubicInOut(t) {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeCubicIn(t) {
  const x = clamp(t, 0, 1);
  return x * x * x;
}

export function easeCubicOut(t) {
  const x = clamp(t, 0, 1);
  return 1 - Math.pow(1 - x, 3);
}

function hashSeed(str) {
  const s = String(str || "slide");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Computes subtle Ken Burns pan & zoom transform strictly capped so edges never reveal gaps.
 */
function computeKenBurnsState(seedKey, slideIndex, motionProgress, params) {
  const h = hashSeed(`${seedKey}#${slideIndex}`);
  const mode = params.motionPattern || "alternating";
  const zoomAmp = clamp(Number(params.zoomRange) || 0, 0, 22) * 0.01;
  const panMax = clamp(Number(params.panDrift) || 0, 0, 64);

  let zoomIn;
  if (mode === "zoom_in") zoomIn = true;
  else if (mode === "zoom_out") zoomIn = false;
  else zoomIn = (h & 1) === 0;

  const baseScale = zoomIn ? 1.0 : 1.0 + zoomAmp;
  const endScale = zoomIn ? 1.0 + zoomAmp : 1.0;
  // Gentle eased motion progress across whole visible lifetime
  const t = clamp(motionProgress, 0, 1);
  const scale = baseScale + (endScale - baseScale) * t;

  // Deterministic gentle drift direction; keep image scaled enough so no blank margin ever shows
  const dirX = ((h >> 2) % 3) - 1; // -1 | 0 | 1
  const dirY = ((h >> 5) % 3) - 1; // -1 | 0 | 1
  const safeFactor = zoomAmp > 0 ? Math.min(1, zoomAmp * 7) : 0.45;
  const startX = -dirX * panMax * 0.5 * safeFactor;
  const endX = dirX * panMax * 0.5 * safeFactor;
  const startY = -dirY * panMax * 0.35 * safeFactor;
  const endY = dirY * panMax * 0.35 * safeFactor;

  const tx = startX + (endX - startX) * t;
  const ty = startY + (endY - startY) * t;
  return { scale, tx, ty };
}

export const SLIDESHOW_STYLES = [
  {
    id: "table_pile",
    mode: "stack",
    badge: "2.5D",
    label: "Table Pile",
    tagline: "Overhead physics desk where prints drop, skid & layer organically",
    defaultParams: {
      deskSurface: "warm_studio_oak_hammelart",
      deskVignette: 42,
      throwFrom: "random",
      throwPower: 62,
      printScale: 62,
      messiness: 62,
      pileDepth: 14,
      paperBorder: true,
      borderThickness: 14,
      paperTone: "cotton",
      shearNudge: true,
      handFlick: true,
    },
    controls: [
      {
        key: "deskSurface",
        type: "segmented",
        label: "Table Surface",
        hint: "Real textured tabletop or ambient gallery glow",
        options: [
          { value: "warm_studio_oak_hammelart", label: "Branded Oak" },
          { value: "warm_studio_oak", label: "Clean Oak" },
          { value: "ambient_halo", label: "Halo" },
        ],
      },
      {
        key: "deskVignette",
        type: "slider",
        label: "Overhead Spot",
        hint: "Soft studio lamp edge darkening on the tabletop",
        min: 0,
        max: 80,
        step: 5,
        unit: "%",
        visibleWhen: (p) => (p.deskSurface || "warm_studio_oak") !== "ambient_halo",
      },
      {
        key: "throwFrom",
        type: "segmented",
        label: "Throw Side",
        hint: "8-way table throws (N/NE/E/SE/S/SW/W/NW) or directional bias",
        options: [
          { value: "random", label: "8-Way" },
          { value: "bottom", label: "Bottom" },
          { value: "sides", label: "Left / Right" },
          { value: "top", label: "Top" },
        ],
      },
      {
        key: "throwPower",
        type: "slider",
        label: "Throw Velocity",
        hint: "Crisp flick speed & sliding skid across desk",
        min: 25,
        max: 100,
        step: 5,
        unit: "%",
      },
      {
        key: "printScale",
        type: "slider",
        label: "Print Size",
        hint: "Desk footprint so older sheets stay peeking underneath",
        min: 40,
        max: 84,
        step: 2,
        unit: "%",
      },
      {
        key: "messiness",
        type: "slider",
        label: "Scatter & Tilt",
        hint: "How loosely settled photos sprawl around center",
        min: 0,
        max: 100,
        step: 5,
        unit: "%",
      },
      {
        key: "pileDepth",
        type: "slider",
        label: "Pile Depth",
        hint: "Oldest bottom sheet softly fades once above count",
        min: 6,
        max: 24,
        step: 1,
        unit: "",
      },
      {
        key: "paperBorder",
        type: "toggle",
        label: "Paper Passepartout",
        hint: "Archival white lithography matte border around each print",
      },
      {
        key: "borderThickness",
        type: "slider",
        label: "Matte Thickness",
        hint: "Width of the lithography paper border",
        min: 4,
        max: 36,
        step: 1,
        unit: "px",
        visibleWhen: (p) => p.paperBorder !== false,
      },
      {
        key: "paperTone",
        type: "segmented",
        label: "Paper Stock",
        hint: "Lithography matte paper tone",
        visibleWhen: (p) => p.paperBorder !== false,
        options: [
          { value: "cotton", label: "Cotton" },
          { value: "white", label: "White" },
          { value: "charcoal", label: "Charcoal" },
        ],
      },
      {
        key: "shearNudge",
        type: "toggle",
        label: "Landing Friction Nudge",
        hint: "Sliding sheet subtly nudges the prints directly beneath it",
      },
      {
        key: "handFlick",
        type: "toggle",
        label: "Interactive Desk Flick",
        hint: "Grab & slide photos on the desk (clicks still open Lightbox)",
      },
    ],
  },

  {
    id: "silk_crossfade",
    badge: "2D",
    label: "Silk Crossfade",
    tagline: "Velvety photographic dissolve with subtle depth breath",
    defaultParams: {
      transitionMs: 1150,
      breathScale: 4,
      softBlur: 6,
    },
    controls: [
      {
        key: "transitionMs",
        type: "slider",
        label: "Dissolve Speed",
        hint: "Overlap duration between prints",
        min: 350,
        max: 2800,
        step: 50,
        unit: "ms",
      },
      {
        key: "breathScale",
        type: "slider",
        label: "Depth Breath",
        hint: "Subtle settle zoom during crossfade",
        min: 0,
        max: 12,
        step: 1,
        unit: "%",
      },
      {
        key: "softBlur",
        type: "slider",
        label: "Silk Softness",
        hint: "Dreamy optical feather at peak overlap",
        min: 0,
        max: 20,
        step: 1,
        unit: "px",
      },
    ],
    buildRestFrame: () => ({
      visible: true,
      opacity: 1,
      transform: "translate3d(0px, 0px, 0px) scale(1)",
      imgTransform: "scale(1)",
      filter: "none",
      sheenOpacity: 0,
      sheenPos: 50,
      zIndex: 2,
    }),
    buildTransitionFrame: ({ role, progress, params }) => {
      const e = easeCubicInOut(progress);
      const breath = clamp(Number(params.breathScale) || 0, 0, 14) * 0.01;
      const blurMax = clamp(Number(params.softBlur) || 0, 0, 24);
      if (role === "from") {
        const s = 1 - breath * e;
        const blur = blurMax * easeCubicIn(progress) * 0.65;
        return {
          visible: true,
          opacity: clamp(1 - e, 0, 1),
          transform: `translate3d(0px, 0px, 0px) scale(${s.toFixed(4)})`,
          imgTransform: "scale(1)",
          filter: blur > 0.1 ? `blur(${blur.toFixed(2)}px)` : "none",
          sheenOpacity: 0,
          sheenPos: 50,
          zIndex: 2,
        };
      }
      const s = 1 + breath * (1 - e);
      const blur = blurMax * (1 - easeCubicOut(progress)) * 0.55;
      return {
        visible: true,
        opacity: clamp(e, 0, 1),
        transform: `translate3d(0px, 0px, 0px) scale(${s.toFixed(4)})`,
        imgTransform: "scale(1)",
        filter: blur > 0.1 ? `blur(${blur.toFixed(2)}px)` : "none",
        sheenOpacity: 0,
        sheenPos: 50,
        zIndex: 3,
      };
    },
  },

  {
    id: "cinema_drift",
    badge: "2D",
    label: "Cinema Pan & Zoom",
    tagline: "Continuous gallery Ken Burns drift that keeps stills breathing",
    defaultParams: {
      transitionMs: 1400,
      zoomRange: 9,
      panDrift: 26,
      motionPattern: "alternating",
    },
    controls: [
      {
        key: "transitionMs",
        type: "slider",
        label: "Crossfade Overlap",
        hint: "Duration where both drifting frames blend",
        min: 450,
        max: 3000,
        step: 50,
        unit: "ms",
      },
      {
        key: "zoomRange",
        type: "slider",
        label: "Zoom Amplitude",
        hint: "Slow camera push/pull across each hold",
        min: 0,
        max: 18,
        step: 1,
        unit: "%",
      },
      {
        key: "panDrift",
        type: "slider",
        label: "Lateral Drift",
        hint: "Gentle exhibition pan travel inside the frame",
        min: 0,
        max: 60,
        step: 2,
        unit: "px",
      },
      {
        key: "motionPattern",
        type: "segmented",
        label: "Camera Direction",
        options: [
          { value: "alternating", label: "Varied" },
          { value: "zoom_in", label: "Push In" },
          { value: "zoom_out", label: "Pull Back" },
        ],
      },
    ],
    buildRestFrame: ({ seedKey, slideIndex, motionProgress, params }) => {
      const kb = computeKenBurnsState(seedKey, slideIndex, motionProgress, params);
      return {
        visible: true,
        opacity: 1,
        transform: "translate3d(0px, 0px, 0px)",
        imgTransform: `translate3d(${kb.tx.toFixed(2)}px, ${kb.ty.toFixed(2)}px, 0px) scale(${kb.scale.toFixed(4)})`,
        filter: "none",
        sheenOpacity: 0,
        sheenPos: 50,
        zIndex: 2,
      };
    },
    buildTransitionFrame: ({ role, progress, seedKey, slideIndex, motionProgress, params }) => {
      const e = easeCubicInOut(progress);
      const kb = computeKenBurnsState(seedKey, slideIndex, motionProgress, params);
      return {
        visible: true,
        opacity: role === "from" ? clamp(1 - e, 0, 1) : clamp(e, 0, 1),
        transform: "translate3d(0px, 0px, 0px)",
        imgTransform: `translate3d(${kb.tx.toFixed(2)}px, ${kb.ty.toFixed(2)}px, 0px) scale(${kb.scale.toFixed(4)})`,
        filter: "none",
        sheenOpacity: 0,
        sheenPos: 50,
        zIndex: role === "from" ? 2 : 3,
      };
    },
  },

  {
    id: "velvet_glide",
    badge: "2D",
    label: "Velvet Glide",
    tagline: "Crisp backlit slide with layered parallax depth retreat",
    defaultParams: {
      transitionMs: 850,
      direction: "horizontal",
      parallaxRatio: 45,
      dimOutgoing: 38,
    },
    controls: [
      {
        key: "transitionMs",
        type: "slider",
        label: "Glide Speed",
        hint: "Slide travel duration",
        min: 350,
        max: 2000,
        step: 50,
        unit: "ms",
      },
      {
        key: "direction",
        type: "segmented",
        label: "Slide Axis",
        options: [
          { value: "horizontal", label: "Horizontal" },
          { value: "vertical", label: "Vertical" },
        ],
      },
      {
        key: "parallaxRatio",
        type: "slider",
        label: "Parallax Lag",
        hint: "How far the outgoing artwork glides beneath the new frame",
        min: 0,
        max: 85,
        step: 5,
        unit: "%",
      },
      {
        key: "dimOutgoing",
        type: "slider",
        label: "Retreat Dimming",
        hint: "Subtle depth fade on the departing slide",
        min: 0,
        max: 75,
        step: 5,
        unit: "%",
      },
    ],
    buildRestFrame: () => ({
      visible: true,
      opacity: 1,
      transform: "translate3d(0px, 0px, 0px) scale(1)",
      imgTransform: "scale(1)",
      filter: "none",
      sheenOpacity: 0,
      sheenPos: 50,
      zIndex: 2,
    }),
    buildTransitionFrame: ({ role, progress, direction, stageW, stageH, params }) => {
      const e = easeCubicInOut(progress);
      const axis = params.direction === "vertical" ? "vertical" : "horizontal";
      const span = axis === "horizontal" ? Math.max(240, stageW) : Math.max(200, stageH);
      const para = clamp(Number(params.parallaxRatio) || 0, 0, 90) * 0.01;
      const dim = clamp(Number(params.dimOutgoing) || 0, 0, 80) * 0.01;
      const dir = direction >= 0 ? 1 : -1;

      if (role === "from") {
        const shift = -dir * e * span * Math.max(0.18, para);
        const s = 1 - 0.06 * e;
        const opacity = clamp(1 - e * (0.28 + dim * 0.72), 0, 1);
        const tx = axis === "horizontal" ? shift : 0;
        const ty = axis === "vertical" ? shift : 0;
        return {
          visible: true,
          opacity,
          transform: `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0px) scale(${s.toFixed(4)})`,
          imgTransform: "scale(1)",
          filter: dim > 0.05 ? `brightness(${(1 - dim * 0.45 * e).toFixed(3)})` : "none",
          sheenOpacity: 0,
          sheenPos: 50,
          zIndex: 2,
        };
      }

      const enterShift = dir * (1 - e) * span * 1.04;
      const tx = axis === "horizontal" ? enterShift : 0;
      const ty = axis === "vertical" ? enterShift : 0;
      return {
        visible: true,
        opacity: clamp(0.4 + 0.6 * easeCubicOut(progress), 0, 1),
        transform: `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0px) scale(1)`,
        imgTransform: "scale(1)",
        filter: "none",
        sheenOpacity: 0,
        sheenPos: 50,
        zIndex: 3,
      };
    },
  },

  {
    id: "louvre_flip",
    badge: "3D",
    label: "Louvre Glass Flip",
    tagline: "Hero-scale 3D museum turn with clean edge-on handoff & sheen",
    defaultParams: {
      transitionMs: 1050,
      flipAxis: "vertical",
      perspectivePx: 1450,
      archLift: 12,
      specularSheen: true,
    },
    controls: [
      {
        key: "transitionMs",
        type: "slider",
        label: "Turn Speed",
        hint: "Duration of the 3D card turn",
        min: 450,
        max: 2400,
        step: 50,
        unit: "ms",
      },
      {
        key: "flipAxis",
        type: "segmented",
        label: "Turn Axis",
        options: [
          { value: "vertical", label: "Gallery Y-Turn" },
          { value: "horizontal", label: "Easel X-Flip" },
        ],
      },
      {
        key: "perspectivePx",
        type: "slider",
        label: "Lens Depth",
        hint: "Lower = bolder 3D angle, higher = flatter telephoto lens",
        min: 750,
        max: 2400,
        step: 50,
        unit: "px",
      },
      {
        key: "archLift",
        type: "slider",
        label: "Center Clearance",
        hint: "Graceful zoom breath mid-turn so edges never clip",
        min: 0,
        max: 24,
        step: 1,
        unit: "%",
      },
      {
        key: "specularSheen",
        type: "toggle",
        label: "Glass Light Sweep",
        hint: "Soft directional sheen catching the print as it rotates",
      },
    ],
    buildRestFrame: () => ({
      visible: true,
      opacity: 1,
      transform: "translate3d(0px, 0px, 0px) scale(1)",
      imgTransform: "scale(1)",
      filter: "none",
      sheenOpacity: 0,
      sheenPos: 50,
      zIndex: 2,
    }),
    buildTransitionFrame: ({ role, progress, direction, params }) => {
      const persp = clamp(Number(params.perspectivePx) || 1450, 650, 2800);
      const lift = clamp(Number(params.archLift) || 0, 0, 28) * 0.01;
      const axisFn = params.flipAxis === "horizontal" ? "rotateX" : "rotateY";
      const dir = direction >= 0 ? 1 : -1;
      const archScale = 1 - lift * Math.sin(clamp(progress, 0, 1) * Math.PI);
      const sheenEnabled = params.specularSheen !== false;

      if (role === "from") {
        if (progress >= 0.5) {
          return { visible: false, opacity: 0, zIndex: 1 };
        }
        const u = easeCubicIn(progress * 2);
        const deg = -dir * u * 90;
        const sheen = sheenEnabled ? 0.28 * Math.sin(u * Math.PI * 0.65) : 0;
        return {
          visible: true,
          opacity: 1,
          transform: `perspective(${persp}px) scale(${archScale.toFixed(4)}) ${axisFn}(${deg.toFixed(2)}deg)`,
          imgTransform: "scale(1)",
          filter: `brightness(${(1 - 0.16 * u).toFixed(3)})`,
          sheenOpacity: sheen,
          sheenPos: dir >= 0 ? 25 + u * 55 : 75 - u * 55,
          zIndex: 3,
        };
      }

      if (progress < 0.5) {
        return { visible: false, opacity: 0, zIndex: 1 };
      }
      const v = easeCubicOut((progress - 0.5) * 2);
      const deg = dir * (1 - v) * 90;
      const sheen = sheenEnabled ? 0.34 * (1 - v) : 0;
      return {
        visible: true,
        opacity: 1,
        transform: `perspective(${persp}px) scale(${archScale.toFixed(4)}) ${axisFn}(${deg.toFixed(2)}deg)`,
        imgTransform: "scale(1)",
        filter: `brightness(${(0.86 + 0.14 * v).toFixed(3)})`,
        sheenOpacity: sheen,
        sheenPos: dir >= 0 ? 15 + v * 65 : 85 - v * 65,
        zIndex: 3,
      };
    },
  },
];

export const SLIDESHOW_STYLE_MAP = new Map(SLIDESHOW_STYLES.map((s) => [s.id, s]));

export function getSlideshowStyle(styleId) {
  return SLIDESHOW_STYLE_MAP.get(styleId) || SLIDESHOW_STYLES[0];
}

export function buildDefaultStyleParamsMap() {
  const map = {};
  for (let i = 0; i < SLIDESHOW_STYLES.length; i++) {
    const s = SLIDESHOW_STYLES[i];
    map[s.id] = { ...s.defaultParams };
  }
  return map;
}

export function getSlideshowStyleParams(cfg, styleId) {
  const style = getSlideshowStyle(styleId);
  const custom = cfg?.styleParams?.[style.id];
  return { ...style.defaultParams, ...(custom && typeof custom === "object" ? custom : {}) };
}
