/**
 * Self-contained 60/120fps WebGL 28x28 subdivided mesh transition engine
 * driving both:
 *  - "venom": Symbiote liquid-membrane tear-off (clinging elastic corners,
 *    glossy rippling droplet flight, and concentric glass splash settle)
 *  - "cloth": Whisper-smooth rippling silk fabric whip with directional
 *    folds and velvet light shading.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const VS_SOURCE = `
  attribute vec2 a_pos;
  attribute vec2 a_uv;
  attribute vec2 a_quadUv;
  attribute float a_shade;

  uniform vec2 u_res;

  varying vec2 v_uv;
  varying vec2 v_quadUv;
  varying float v_shade;

  void main() {
    vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    v_uv = a_uv;
    v_quadUv = a_quadUv;
    v_shade = a_shade;
  }
`;

const FS_SOURCE = `
  precision mediump float;

  uniform sampler2D u_tex;
  uniform vec2 u_uvMin;
  uniform vec2 u_uvMax;
  uniform vec2 u_cardSize;
  uniform float u_radius;
  uniform vec3 u_accent;
  uniform float u_isLiquid;

  varying vec2 v_uv;
  varying vec2 v_quadUv;
  varying float v_shade;

  float roundedBoxSDF(vec2 p, vec2 b, float r) {
    vec2 d = abs(p) - b + vec2(r);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
  }

  void main() {
    vec2 texUv = mix(u_uvMin, u_uvMax, v_uv);
    vec4 col = texture2D(u_tex, texUv);

    // Subtle fabric fold shading / glossy liquid ridge highlight
    float lightMod = 1.0 + v_shade * 0.30;
    col.rgb *= lightMod;
    if (u_isLiquid > 0.5 && v_shade > 0.02) {
      float gloss = pow(clamp(v_shade * 1.45, 0.0, 1.0), 2.0) * 0.24;
      col.rgb += mix(vec3(1.0), u_accent, 0.35) * gloss;
    }

    // Crisp anti-aliased rounded corners matching gallery cards
    vec2 p = (v_quadUv - 0.5) * u_cardSize;
    float dist = roundedBoxSDF(p, u_cardSize * 0.5, u_radius);
    float alpha = 1.0 - smoothstep(-1.2, 0.8, dist);
    if (alpha <= 0.01) discard;

    gl_FragColor = vec4(col.rgb, col.a * alpha);
  }
`;

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function createProgram(gl) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VS_SOURCE);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_SOURCE);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

/**
 * Starts a WebGL Venom Splash or Silk Cloth transition on `canvas`.
 * Returns a cancel function cleanly tearing down listeners, textures, and RAF.
 */
export function startWebGLMembraneFlight({
  canvas,
  backdropEl,
  mode = "venom", // "venom" | "cloth"
  thumbUrl,
  origin,
  dest,
  durationMs = 660,
  intensity = 75, // 25..130 (%)
  accentRgbStr = "168, 85, 247",
  onComplete,
}) {
  if (!canvas) {
    onComplete?.();
    return () => {};
  }

  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
  });
  if (!gl) {
    onComplete?.();
    return () => {};
  }

  const prog = createProgram(gl);
  if (!prog) {
    onComplete?.();
    return () => {};
  }

  let cancelled = false;
  let rafId = 0;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);

  // Build 34x34 subdivided quad mesh (stride = 7 floats: x, y, u, v, qu, qv, shade)
  const N = 34;
  const vertsPerRow = N + 1;
  const numVerts = vertsPerRow * vertsPerRow;
  const vertData = new Float32Array(numVerts * 7);

  const indices = [];
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const a = iy * vertsPerRow + ix;
      const b = a + 1;
      const c = a + vertsPerRow;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const indexArr = new Uint16Array(indices);

  const vbo = gl.createBuffer();
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexArr, gl.STATIC_DRAW);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // 1x1 dark fallback pixel while image binds
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([16, 16, 22, 255])
  );

  // Compute initial "cover" UV crop if origin aspect differs from dest aspect (e.g. 1:1 grid)
  const oAsp = origin.w / Math.max(1, origin.h);
  const dAsp = dest.w / Math.max(1, dest.h);
  let uTrim = 0;
  let vTrim = 0;
  if (dAsp > oAsp * 1.02) {
    uTrim = (1 - oAsp / dAsp) * 0.5;
  } else if (oAsp > dAsp * 1.02) {
    vTrim = (1 - dAsp / oAsp) * 0.5;
  }

  const accentParts = accentRgbStr.split(",").map((s) => clamp(Number(s.trim()) || 168, 0, 255));
  const accR = (accentParts[0] ?? 168) / 255;
  const accG = (accentParts[1] ?? 85) / 255;
  const accB = (accentParts[2] ?? 247) / 255;

  // Uniformly normalize [25% .. 150%] across full 0.0 -> 1.0 expressive range (zero hidden dead caps)
  const gooNorm = clamp(((Number(intensity) || 100) - 25) / 125, 0, 1);
  const oLeft = origin.cx - origin.w * 0.5;
  const oTop = origin.cy - origin.h * 0.5;
  const dLeft = dest.stageCx - dest.w * 0.5;
  const dTop = dest.stageCy - dest.h * 0.5;
  const travelDx = dest.stageCx - origin.cx;
  const travelDy = dest.stageCy - origin.cy;
  const rawDist = Math.hypot(travelDx, travelDy);
  const pullX = rawDist > 24 ? travelDx / rawDist : 0.62;
  const pullY = rawDist > 24 ? travelDy / rawDist : 0.78;
  const perpX = -pullY;
  const perpY = pullX;
  const rotRad = ((origin.rz || 0) * Math.PI) / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);

  const aPos = gl.getAttribLocation(prog, "a_pos");
  const aUv = gl.getAttribLocation(prog, "a_uv");
  const aQuadUv = gl.getAttribLocation(prog, "a_quadUv");
  const aShade = gl.getAttribLocation(prog, "a_shade");

  const uRes = gl.getUniformLocation(prog, "u_res");
  const uTex = gl.getUniformLocation(prog, "u_tex");
  const uUvMin = gl.getUniformLocation(prog, "u_uvMin");
  const uUvMax = gl.getUniformLocation(prog, "u_uvMax");
  const uCardSize = gl.getUniformLocation(prog, "u_cardSize");
  const uRadius = gl.getUniformLocation(prog, "u_radius");
  const uAccent = gl.getUniformLocation(prog, "u_accent");
  const uIsLiquid = gl.getUniformLocation(prog, "u_isLiquid");

  const cleanup = () => {
    cancelled = true;
    cancelAnimationFrame(rafId);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    try {
      gl.deleteBuffer(vbo);
      gl.deleteBuffer(ibo);
      gl.deleteTexture(tex);
      gl.deleteProgram(prog);
    } catch {}
  };

  const renderFrame = (raw) => {
    if (cancelled) return;
    const isVenom = mode === "venom";

    if (backdropEl) {
      backdropEl.style.opacity = String(clamp(raw * 2.5, 0, 1));
    }

    const baseEase = 1 - Math.pow(1 - raw, 2.8);
    const curUTrim = uTrim * (1 - baseEase);
    const curVTrim = vTrim * (1 - baseEase);
    const curW = origin.w + (dest.w - origin.w) * baseEase;
    const curH = origin.h + (dest.h - origin.h) * baseEase;
    const curRadius = 10 + (12 - 10) * baseEase;

    const fadeEnv = Math.sin(raw * Math.PI);
    const settleOut = raw > 0.78 ? 1 - (raw - 0.78) / 0.22 : 1;

    let ptr = 0;
    for (let iy = 0; iy < vertsPerRow; iy++) {
      const qv = iy / N;
      const cv = qv - 0.5;
      for (let ix = 0; ix < vertsPerRow; ix++) {
        const qu = ix / N;
        const cu = qu - 0.5;
        const rNorm = Math.min(1, Math.hypot(cu, cv) / 0.7071);

        // Origin rotated vertex coordinate
        const oxLocal = cu * origin.w;
        const oyLocal = cv * origin.h;
        const ox = origin.cx + oxLocal * cosR - oyLocal * sinR;
        const oy = origin.cy + oxLocal * sinR + oyLocal * cosR;

        // Destination flat vertex coordinate
        const dx = dLeft + qu * dest.w;
        const dy = dTop + qv * dest.h;

        let px = ox;
        let py = oy;
        let shade = 0;

        if (isVenom) {
          // Evenly distributed [25% -> 150%] Sticky Goo-Hand Physics:
          // Front edge lands early (1/3 solid!) while trailing corners cling inside socket,
          // stretching a crease-free glossy taffy bridge whose peel, waist, and wave scale linearly across gooNorm [0..1].
          const leadScore = cu * pullX + cv * pullY; // +0.7 front tip -> -0.7 stuck back corner
          const anchor = clamp((0.68 - leadScore) / 1.36, 0, 1);
          const stickyW = clamp(anchor * 0.76 + Math.pow(rNorm, 1.35) * 0.24, 0, 1);

          const maxPeel = 0.14 + gooNorm * 0.54; // 0.14 @ 25% -> 0.464 @ 100% -> 0.68 @ 150%
          const peelT = stickyW * maxPeel;
          const whipSpan = Math.max(0.22, 1.0 - peelT);
          const localT = clamp((raw - peelT) / whipSpan, 0, 1);

          // Smootherstep (0 slope at both 0 & 1 -> silky curve with zero triangle fold creases)
          const t3 = localT * localT * localT * (localT * (localT * 6 - 15) + 10);

          px = ox + (dx - ox) * t3;
          py = oy + (dy - oy) * t3;

          // Proportional taffy neck waisting + glossy organic wave along the stretched slime bridge
          const stretchEnv = Math.sin(localT * Math.PI);
          const stretchSq = stretchEnv * stretchEnv;
          const sideProj = cu * perpX + cv * perpY;
          const waistScale = Math.min(curW, curH) * (0.10 + gooNorm * 0.48);
          const neckPinch = -sideProj * waistScale * stretchSq;
          const waveAmp = 4.0 + gooNorm * 28.0; // 4px @ 25% -> 20.8px @ 100% -> 32px @ 150%
          const gooWave = Math.sin(localT * 8.5 - stickyW * 3.2) * waveAmp * stretchSq;

          px += perpX * (neckPinch + gooWave);
          py += perpY * (neckPinch + gooWave);
          shade = clamp(
            stretchSq * (0.35 + gooNorm * 0.65) * (0.85 - Math.abs(sideProj) * 0.9) + gooWave * 0.015,
            -0.42,
            0.98
          );
        } else {
          // Silk Cloth: Evenly distributed [25% -> 150%] billowing velvet curtain folds
          const proj = cu * pullX + cv * pullY;
          const lagCap = 0.08 + gooNorm * 0.28;
          const lagAmt = clamp((0.5 - proj) * lagCap, 0, 0.38);
          const vRaw = clamp((raw - lagAmt * 0.4) / Math.max(0.25, 1 - lagAmt * 0.4), 0, 1);
          const vEase = 1 - Math.pow(1 - vRaw, 2.45);

          px = ox + (dx - ox) * vEase;
          py = oy + (dy - oy) * vEase;

          const wavePhase = proj * 9.0 + raw * 11.5;
          const flutterAmp = 9.0 + gooNorm * 47.0; // 9px @ 25% -> 37px @ 100% -> 56px @ 150%
          const billowAmp = 5.0 + gooNorm * 21.0;
          const flutter =
            Math.sin(wavePhase) * flutterAmp * fadeEnv * (0.45 + (0.5 - proj) * 0.75) * settleOut;
          const crossBillow =
            Math.cos(cv * 5.2 + raw * 7.5) * billowAmp * fadeEnv * settleOut;

          px += perpX * flutter + pullX * crossBillow * 0.4;
          py += perpY * flutter + crossBillow;
          shade = Math.cos(wavePhase) * (0.35 + gooNorm * 0.60) * fadeEnv * settleOut;
        }

        vertData[ptr++] = px;
        vertData[ptr++] = py;
        vertData[ptr++] = qu;
        vertData[ptr++] = qv;
        vertData[ptr++] = qu;
        vertData[ptr++] = qv;
        vertData[ptr++] = shade;
      }
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(prog);
    gl.uniform2f(uRes, vw, vh);
    gl.uniform2f(uUvMin, curUTrim, curVTrim);
    gl.uniform2f(uUvMax, 1 - curUTrim, 1 - curVTrim);
    gl.uniform2f(uCardSize, curW, curH);
    gl.uniform1f(uRadius, curRadius);
    gl.uniform3f(uAccent, accR, accG, accB);
    gl.uniform1f(uIsLiquid, isVenom ? 1.0 : 0.0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(uTex, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertData, gl.DYNAMIC_DRAW);

    const stride = 7 * 4;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(aQuadUv);
    gl.vertexAttribPointer(aQuadUv, 2, gl.FLOAT, false, stride, 16);
    gl.enableVertexAttribArray(aShade);
    gl.vertexAttribPointer(aShade, 1, gl.FLOAT, false, stride, 24);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.drawElements(gl.TRIANGLES, indexArr.length, gl.UNSIGNED_SHORT, 0);
  };

  const beginAnimation = () => {
    if (cancelled) return;
    const t0 = performance.now();
    renderFrame(0);

    const tick = (now) => {
      if (cancelled) return;
      const raw = clamp((now - t0) / durationMs, 0, 1);
      renderFrame(raw);
      if (raw < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        cleanup();
        if (backdropEl) backdropEl.style.opacity = "1";
        onComplete?.();
      }
    };
    rafId = requestAnimationFrame(tick);
  };

  let started = false;
  const startWithImage = () => {
    if (started || cancelled) return;
    started = true;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    beginAnimation();
  };

  const img = new Image();
  img.onload = startWithImage;
  img.onerror = () => {
    if (started || cancelled) return;
    started = true;
    beginAnimation();
  };
  img.src = thumbUrl;

  if (img.complete && img.naturalWidth > 0) {
    startWithImage();
  }

  return cleanup;
}
