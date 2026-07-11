/* AnimeCam — finger-framed real-time stylization
 * Hand tracking: MediaPipe Tasks Vision (HandLandmarker)
 * Head tracking: MediaPipe FaceLandmarker (tilt/position/shake drive the effects)
 * Stylization: two-pass WebGL (bilateral smooth → style shader with XDoG ink),
 * composited into the quadrilateral formed by both thumbs + index fingertips.
 */

// MediaPipe is loaded at startup: CDN first, local vendor/ fallback (see initTracking).
const MP_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MP_VENDOR = "./vendor/tasks-vision";
const HAND_MODEL_CDN =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const HAND_MODEL_VENDOR = "./vendor/models/hand_landmarker.task";
const FACE_MODEL_CDN =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const FACE_MODEL_VENDOR = "./vendor/models/face_landmarker.task";

// ---------------------------------------------------------------- DOM
const video = document.getElementById("video");
const canvas = document.getElementById("output");
const ctx = canvas.getContext("2d");
const startScreen = document.getElementById("start-screen");
const loadingScreen = document.getElementById("loading-screen");
const loadingText = document.getElementById("loading-text");
const statusHands = document.getElementById("status-hands");
const statusMask = document.getElementById("status-mask");
const statusStyle = document.getElementById("status-style");
const statusFps = document.getElementById("status-fps");
const chkDebug = document.getElementById("chk-debug");
const chkAutoMix = document.getElementById("chk-automix");
const errorDialog = document.getElementById("error-dialog");
const errorText = document.getElementById("error-text");

// ---------------------------------------------------------------- Shaders
const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Pass 1 — edge-preserving (bilateral) smoothing. Flattens skin/walls into
// clean cel regions before quantization, like anime shading.
const SMOOTH_FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
void main() {
  vec3 c0 = texture2D(u_tex, v_uv).rgb;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int i = -2; i <= 2; i++) {
    for (int j = -2; j <= 2; j++) {
      vec3 c = texture2D(u_tex, v_uv + u_texel * vec2(float(i), float(j)) * 1.5).rgb;
      float sw = exp(-float(i * i + j * j) / 6.0);
      vec3 d = c - c0;
      float rw = exp(-dot(d, d) / 0.06);
      float w = sw * rw;
      sum += c * w;
      wsum += w;
    }
  }
  gl_FragColor = vec4(sum / wsum, 1.0);
}`;

// Shared helpers for style passes. u_tex is the SMOOTHED frame.
const FRAG_COMMON = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_time;
uniform float u_roll;   /* head tilt, radians */
uniform float u_headx;  /* head x 0..1 (0.5 = center) */
uniform float u_seed;   /* re-randomized on every style switch */

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float tanh_(float x) {
  float e = exp(2.0 * clamp(x, -8.0, 8.0));
  return (e - 1.0) / (e + 1.0);
}

vec2 rot2(vec2 p, float a) {
  float s = sin(a), c = cos(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float gaussLum(vec2 uv, float scale) {
  float s = 0.0, w = 0.0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      float g = exp(-float(i * i + j * j) / 2.0);
      s += g * lum(texture2D(u_tex, uv + u_texel * vec2(float(i), float(j)) * scale).rgb);
      w += g;
    }
  }
  return s / w;
}

/* XDoG: smooth, variable-width ink lines. Returns 1 = ink. */
float xdog(vec2 uv) {
  float g1 = gaussLum(uv, 1.0);
  float g2 = gaussLum(uv, 2.4);
  float u = g1 - 0.985 * g2;
  float e = (u > 0.004) ? 1.0 : 1.0 + tanh_(45.0 * (u - 0.004));
  return clamp(1.0 - e, 0.0, 1.0);
}

vec3 hueRotate(vec3 c, float a) {
  vec3 yiq = vec3(
    dot(c, vec3(0.299, 0.587, 0.114)),
    dot(c, vec3(0.596, -0.274, -0.322)),
    dot(c, vec3(0.211, -0.523, 0.312))
  );
  float h = atan(yiq.z, yiq.y) + a;
  float ch = length(yiq.yz);
  vec3 y2 = vec3(yiq.x, ch * cos(h), ch * sin(h));
  return clamp(vec3(
    dot(y2, vec3(1.0, 0.956, 0.621)),
    dot(y2, vec3(1.0, -0.272, -0.647)),
    dot(y2, vec3(1.0, -1.106, 1.703))
  ), 0.0, 1.0);
}`;

const STYLES = {
  anime: {
    label: "Anime",
    frag: FRAG_COMMON + `
void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb;
  float Y = max(lum(c), 0.0001);

  /* soft cel bands: quantize luminance, keep chroma */
  float n = 5.0;
  float band = floor(Y * n);
  float f = Y * n - band;
  float soft = smoothstep(0.40, 0.60, f);
  float Yq = clamp((band + 0.3 + soft * 0.55) / n, 0.0, 1.0);
  vec3 cel = c * (Yq / Y);
  cel = clamp(mix(vec3(Yq), cel, 1.6), 0.0, 1.0);   /* saturation push */
  cel = pow(cel, vec3(0.92));

  /* head position sweeps the palette */
  cel = hueRotate(cel, (u_headx - 0.5) * 0.7 + u_seed * 0.05);

  float ink = xdog(v_uv);
  cel = mix(cel, vec3(0.07, 0.05, 0.12), ink * 0.92);
  gl_FragColor = vec4(cel, 1.0);
}`,
  },

  manga: {
    label: "Manga",
    frag: FRAG_COMMON + `
void main() {
  float t = pow(lum(texture2D(u_tex, v_uv).rgb), 0.88);
  float ink = xdog(v_uv);

  /* screentone rotates with head tilt */
  float ang = 0.55 + u_roll * 1.2;
  vec2 pr = rot2(gl_FragCoord.xy + u_seed * 37.0, ang);

  /* halftone dots sized by tone */
  float cell = 7.0;
  vec2 g = mod(pr, cell) - cell * 0.5;
  float dotR = cell * 0.66 * (1.0 - smoothstep(0.10, 0.92, t));
  float dotInk = 1.0 - smoothstep(dotR - 0.8, dotR + 0.8, length(g));

  /* diagonal hatch for shadows */
  float hatch = 1.0 - step(2.2, mod(pr.x + pr.y * 0.2, 8.0));

  float paper = 1.0;
  if (t < 0.90) paper = min(paper, 1.0 - dotInk);
  if (t < 0.32) paper = min(paper, 1.0 - hatch);
  if (t < 0.10) paper = 0.0;
  paper = min(paper, 1.0 - ink);

  vec3 col = mix(vec3(0.05, 0.05, 0.08), vec3(0.98, 0.97, 0.93), paper);
  gl_FragColor = vec4(col, 1.0);
}`,
  },

  retro: {
    label: "Retro",
    frag: FRAG_COMMON + `
void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb;
  float Y = max(lum(c), 0.0001);

  c = mix(vec3(Y), c, 0.72);
  float n = 6.0;
  float band = floor(Y * n);
  float soft = smoothstep(0.38, 0.62, Y * n - band);
  float Yq = clamp((band + 0.3 + soft * 0.5) / n, 0.0, 1.0);
  c = c * (Yq / Y);
  c = c * vec3(1.10, 1.00, 0.84) + vec3(0.06, 0.04, 0.0);   /* warm cast */
  c = hueRotate(c, (u_headx - 0.5) * 0.25);

  /* paper grain + vignette */
  float grain = (hash(gl_FragCoord.xy + fract(u_time) * 61.0) - 0.5) * 0.09;
  c += grain;
  float d = distance(v_uv, vec2(0.5));
  c *= 1.0 - smoothstep(0.42, 0.85, d) * 0.35;

  float ink = xdog(v_uv);
  c = mix(c, vec3(0.30, 0.22, 0.13), ink * 0.6);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
  },

  oil: {
    label: "Oil Paint",
    frag: FRAG_COMMON + `
/* 8-sector generalized Kuwahara: directional wedge statistics, weighted by
 * inverse variance -> strokes follow features. Head tilt biases direction. */
void main() {
  vec3 num = vec3(0.0);
  float den = 0.0;

  for (int k = 0; k < 8; k++) {
    float ang = float(k) * 0.7853982 + u_roll * 0.6;
    vec3 mean = vec3(0.0);
    vec3 sq = vec3(0.0);
    float cnt = 0.0;
    for (int r = 1; r <= 4; r++) {
      for (int s = -1; s <= 1; s++) {
        vec2 dir = rot2(vec2(1.0, 0.0), ang + float(s) * 0.30);
        vec3 c = texture2D(u_tex, v_uv + u_texel * dir * float(r) * 1.6).rgb;
        mean += c; sq += c * c; cnt += 1.0;
      }
    }
    mean /= cnt;
    vec3 v3 = sq / cnt - mean * mean;
    float v = v3.r + v3.g + v3.b;
    float w = 1.0 / (0.0004 + v * v * v * v);
    num += mean * w;
    den += w;
  }

  vec3 c = num / den;
  c = clamp(mix(vec3(lum(c)), c, 1.25) * vec3(1.06, 1.0, 0.92), 0.0, 1.0);

  /* canvas texture */
  float bump = hash(floor(gl_FragCoord.xy / 2.0) + u_seed) * 0.08;
  c *= 0.96 + bump;
  gl_FragColor = vec4(c, 1.0);
}`,
  },
};
const STYLE_KEYS = Object.keys(STYLES);

// ---------------------------------------------------------------- WebGL pipeline
const glCanvas = document.createElement("canvas");
const gl = glCanvas.getContext("webgl", { premultipliedAlpha: false });
const programs = {};
let smoothProg = null;
let videoTexture = null;
let smoothTexture = null;
let fbo = null;

function compileShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error("Shader compile error: " + gl.getShaderInfoLog(s));
  }
  return s;
}

function buildProgram(fragSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("Program link error: " + gl.getProgramInfoLog(p));
  }
  return {
    program: p,
    aPos: gl.getAttribLocation(p, "a_pos"),
    uTexel: gl.getUniformLocation(p, "u_texel"),
    uTime: gl.getUniformLocation(p, "u_time"),
    uRoll: gl.getUniformLocation(p, "u_roll"),
    uHeadx: gl.getUniformLocation(p, "u_headx"),
    uSeed: gl.getUniformLocation(p, "u_seed"),
  };
}

function makeTexture(w, h) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return t;
}

function initGL() {
  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  smoothProg = buildProgram(SMOOTH_FRAG);
  for (const [key, style] of Object.entries(STYLES)) {
    programs[key] = buildProgram(style.frag);
  }

  videoTexture = makeTexture();
  smoothTexture = makeTexture(glCanvas.width, glCanvas.height);
  fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, smoothTexture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function drawPass(prog, tex, head) {
  gl.useProgram(prog.program);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform2f(prog.uTexel, 1 / glCanvas.width, 1 / glCanvas.height);
  if (prog.uTime) gl.uniform1f(prog.uTime, performance.now() / 1000);
  if (prog.uRoll) gl.uniform1f(prog.uRoll, head.roll);
  if (prog.uHeadx) gl.uniform1f(prog.uHeadx, head.x);
  if (prog.uSeed) gl.uniform1f(prog.uSeed, styleSeed);
  gl.enableVertexAttribArray(prog.aPos);
  gl.vertexAttribPointer(prog.aPos, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function renderStylized(styleKey, head) {
  gl.viewport(0, 0, glCanvas.width, glCanvas.height);

  // upload frame
  gl.bindTexture(gl.TEXTURE_2D, videoTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);

  // pass 1: bilateral smooth -> FBO
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  drawPass(smoothProg, videoTexture, headState);

  // pass 2: style -> canvas
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  drawPass(programs[styleKey], smoothTexture, head);
}

// ---------------------------------------------------------------- Tracking
let handLandmarker = null;
let faceLandmarker = null;

async function initTracking() {
  loadingText.textContent = "Loading tracking models…";

  let base = MP_CDN;
  let mp;
  try {
    mp = await import(`${MP_CDN}/vision_bundle.mjs`);
  } catch {
    base = MP_VENDOR;
    mp = await import(`${MP_VENDOR}/vision_bundle.mjs`);
  }

  const vision = await mp.FilesetResolver.forVisionTasks(`${base}/wasm`);

  const handOptions = (modelPath) => ({
    baseOptions: { modelAssetPath: modelPath, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    handLandmarker = await mp.HandLandmarker.createFromOptions(vision, handOptions(HAND_MODEL_CDN));
  } catch {
    handLandmarker = await mp.HandLandmarker.createFromOptions(vision, handOptions(HAND_MODEL_VENDOR));
  }

  // Face tracking is optional — the app degrades gracefully without it.
  const faceOptions = (modelPath) => ({
    baseOptions: { modelAssetPath: modelPath, delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: 1,
  });
  try {
    faceLandmarker = await mp.FaceLandmarker.createFromOptions(vision, faceOptions(FACE_MODEL_CDN));
  } catch {
    try {
      faceLandmarker = await mp.FaceLandmarker.createFromOptions(vision, faceOptions(FACE_MODEL_VENDOR));
    } catch {
      faceLandmarker = null;
    }
  }
}

// Head state derived from face landmarks each frame.
const headState = { present: false, x: 0.5, y: 0.5, roll: 0, speed: 0 };
let prevNose = null;
let prevNoseTime = 0;

function updateHead(faceLandmarks, now) {
  if (!faceLandmarks || faceLandmarks.length === 0) {
    headState.present = false;
    headState.speed = 0;
    prevNose = null;
    return;
  }
  const lm = faceLandmarks[0];
  const nose = lm[1];               // nose tip
  const eL = lm[33], eR = lm[263];  // eye outer corners
  headState.present = true;
  headState.x = nose.x;
  headState.y = nose.y;
  headState.roll = Math.atan2(eR.y - eL.y, eR.x - eL.x);

  if (prevNose) {
    const dt = Math.max((now - prevNoseTime) / 1000, 0.001);
    const d = Math.hypot(nose.x - prevNose.x, nose.y - prevNose.y);
    // low-pass the speed a little
    headState.speed = headState.speed * 0.6 + (d / dt) * 0.4;
  }
  prevNose = { x: nose.x, y: nose.y };
  prevNoseTime = now;
}

// ---------------------------------------------------------------- Quad geometry
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const SMOOTHING = 0.45; // 0 = frozen, 1 = raw
let smoothedQuad = null;

/** Sort 4 points by angle around their centroid → simple (non-crossing) quad. */
function orderQuad(pts) {
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  return [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );
}

// ?demo — preview styles with a fixed quad, no hands needed.
const DEMO_QUAD = new URLSearchParams(location.search).has("demo");

function updateQuad(landmarksPerHand) {
  // Mask requires BOTH hands — one hand (or none) means no mask.
  if (landmarksPerHand.length < 2) {
    smoothedQuad = null;
    if (DEMO_QUAD) {
      const W = canvas.width, H = canvas.height;
      return [
        { x: W * 0.22, y: H * 0.18 },
        { x: W * 0.80, y: H * 0.26 },
        { x: W * 0.76, y: H * 0.84 },
        { x: W * 0.18, y: H * 0.74 },
      ];
    }
    return null;
  }
  const raw = [];
  for (let h = 0; h < 2; h++) {
    const lm = landmarksPerHand[h];
    raw.push({ x: lm[THUMB_TIP].x * canvas.width, y: lm[THUMB_TIP].y * canvas.height });
    raw.push({ x: lm[INDEX_TIP].x * canvas.width, y: lm[INDEX_TIP].y * canvas.height });
  }
  const ordered = orderQuad(raw);
  if (!smoothedQuad) {
    smoothedQuad = ordered;
  } else {
    smoothedQuad = smoothedQuad.map((p, i) => ({
      x: p.x + (ordered[i].x - p.x) * SMOOTHING,
      y: p.y + (ordered[i].y - p.y) * SMOOTHING,
    }));
  }
  return smoothedQuad;
}

// ---------------------------------------------------------------- Style switching
let currentStyle = "anime";
let styleSeed = Math.random() * 10;
let nextAutoSwitch = 0;
let lastShakeSwitch = 0;
const bursts = []; // manga speed-line bursts (timestamps)

function pickRandomStyle() {
  const others = STYLE_KEYS.filter((k) => k !== currentStyle);
  return others[(Math.random() * others.length) | 0];
}

function setStyle(key, { fromAuto = false } = {}) {
  if (!STYLES[key]) return;
  currentStyle = key;
  styleSeed = Math.random() * 10;
  const auto = chkAutoMix.checked;
  statusStyle.textContent = `Style: ${STYLES[key].label}${auto ? " ★auto" : ""}`;
  document.querySelectorAll(".style-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.style === key)
  );
  if (!fromAuto) {
    // manual pick: pause auto-mix so the choice sticks
    chkAutoMix.checked = false;
    statusStyle.textContent = `Style: ${STYLES[key].label}`;
  }
}

function autoMixTick(now, maskActive) {
  if (!chkAutoMix.checked || !maskActive) return;
  if (now >= nextAutoSwitch) {
    setStyle(pickRandomStyle(), { fromAuto: true });
    nextAutoSwitch = now + 250 + Math.random() * 600;
  }
  // quick head shake forces an instant switch
  if (headState.speed > 1.1 && now - lastShakeSwitch > 300) {
    lastShakeSwitch = now;
    setStyle(pickRandomStyle(), { fromAuto: true });
    nextAutoSwitch = now + 250 + Math.random() * 600;
    bursts.push(now);
  }
}

// ---------------------------------------------------------------- Tracker drawing
const HAND_LINKS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

function inkStroke(fn) {
  // draw twice: dark underlay, glowing cyan top — modern HUD look
  ctx.strokeStyle = "rgba(2,6,23,0.7)";
  ctx.lineWidth = 4;
  fn();
  ctx.strokeStyle = "rgba(103,232,249,0.95)";
  ctx.lineWidth = 1.6;
  fn();
}

function drawReticle(x, y, r, t, label) {
  // rotating dashed ring
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * 1.8);
  ctx.setLineDash([7, 5]);
  inkStroke(() => {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.restore();

  // pulsing corner brackets
  const b = r + 6 + Math.sin(t * 5) * 2;
  const s = 6;
  inkStroke(() => {
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.moveTo(x + sx * b, y + sy * (b - s));
      ctx.lineTo(x + sx * b, y + sy * b);
      ctx.lineTo(x + sx * (b - s), y + sy * b);
    }
    ctx.stroke();
  });

  // crosshair ticks + center dot
  inkStroke(() => {
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(x + dx * (r - 4), y + dy * (r - 4));
      ctx.lineTo(x + dx * (r + 4), y + dy * (r + 4));
    }
    ctx.stroke();
  });
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(x, y, 2.6, 0, Math.PI * 2);
  ctx.fill();

  // label (un-mirrored so it stays readable)
  ctx.save();
  ctx.translate(x, y - r - 12);
  ctx.scale(-1, 1);
  ctx.font = "bold 11px Verdana, sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(17,17,17,0.9)";
  ctx.strokeText(label, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

function drawTrackers(landmarksPerHand, t, W, H) {
  landmarksPerHand.forEach((lm, hi) => {
    // faint skeleton
    ctx.save();
    ctx.globalAlpha = 0.55;
    inkStroke(() => {
      ctx.beginPath();
      for (const [a, b] of HAND_LINKS) {
        ctx.moveTo(lm[a].x * W, lm[a].y * H);
        ctx.lineTo(lm[b].x * W, lm[b].y * H);
      }
      ctx.stroke();
    });
    // knuckle dots
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    for (const p of lm) {
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // thumb→index dashed link
    const tx = lm[THUMB_TIP].x * W, ty = lm[THUMB_TIP].y * H;
    const ix = lm[INDEX_TIP].x * W, iy = lm[INDEX_TIP].y * H;
    ctx.setLineDash([4, 6]);
    inkStroke(() => {
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(ix, iy);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // fingertip reticles
    drawReticle(tx, ty, 15, t + hi, `T${hi + 1}`);
    drawReticle(ix, iy, 13, t * 1.3 + hi + 2, `I${hi + 1}`);
  });

  // head indicator
  if (headState.present) {
    const hx = headState.x * W, hy = headState.y * H;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.setLineDash([2, 5]);
    inkStroke(() => {
      ctx.beginPath();
      ctx.arc(hx, hy, 24, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    // roll indicator line across the circle
    const a = headState.roll;
    inkStroke(() => {
      ctx.beginPath();
      ctx.moveTo(hx - Math.cos(a) * 24, hy - Math.sin(a) * 24);
      ctx.lineTo(hx + Math.cos(a) * 24, hy + Math.sin(a) * 24);
      ctx.stroke();
    });
    ctx.restore();
  }
}

function drawBursts(now, W, H) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const age = now - bursts[i];
    if (age > 380) { bursts.splice(i, 1); continue; }
    const k = 1 - age / 380;
    ctx.save();
    ctx.globalAlpha = k * 0.8;
    ctx.translate(W / 2, H / 2);
    for (let l = 0; l < 26; l++) {
      const a = (l / 26) * Math.PI * 2 + bursts[i] * 0.001;
      const r0 = Math.min(W, H) * (0.28 + 0.1 * (l % 3));
      const r1 = Math.hypot(W, H) * 0.6;
      ctx.strokeStyle = l % 2 ? "rgba(34,211,238,0.9)" : "rgba(255,255,255,0.9)";
      ctx.lineWidth = 2 + (l % 3);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- Render loop
let lastVideoTime = -1;
let latestLandmarks = [];
let frames = 0;
let fpsTimer = performance.now();

function drawFrame() {
  if (video.readyState < 2) {
    requestAnimationFrame(drawFrame);
    return;
  }
  const now = performance.now();

  // Run detection once per new video frame.
  if (handLandmarker && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = handLandmarker.detectForVideo(video, now);
    latestLandmarks = result.landmarks || [];
    if (faceLandmarker) {
      const face = faceLandmarker.detectForVideo(video, now + 0.01);
      updateHead(face.faceLandmarks, now);
    }
  }

  const W = canvas.width;
  const H = canvas.height;
  const quad = updateQuad(latestLandmarks);
  autoMixTick(now, !!quad);

  ctx.save();
  // Mirror everything (video + landmark space) so it behaves like a mirror.
  ctx.translate(W, 0);
  ctx.scale(-1, 1);

  ctx.drawImage(video, 0, 0, W, H);

  if (quad) {
    renderStylized(currentStyle, headState);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(quad[0].x, quad[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(quad[i].x, quad[i].y);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(glCanvas, 0, 0, W, H);
    ctx.restore();

    // Quad border — neon edge: dark underlay + dashed cyan
    ctx.beginPath();
    ctx.moveTo(quad[0].x, quad[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(quad[i].x, quad[i].y);
    ctx.closePath();
    ctx.strokeStyle = "rgba(2, 6, 23, 0.8)";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = "rgba(34, 211, 238, 0.95)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([12, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (chkDebug.checked) {
    drawTrackers(latestLandmarks, now / 1000, W, H);
  }

  drawBursts(now, W, H);
  ctx.restore();

  // Status bar
  statusHands.textContent =
    `Hands: ${Math.min(latestLandmarks.length, 2)}/2` + (headState.present ? " ·Head" : "");
  statusMask.textContent = quad ? "Mask: ACTIVE" : "Mask: inactive";

  frames++;
  if (now - fpsTimer >= 1000) {
    statusFps.textContent = `FPS: ${frames}`;
    frames = 0;
    fpsTimer = now;
  }

  requestAnimationFrame(drawFrame);
}

// ---------------------------------------------------------------- Startup
async function start() {
  startScreen.classList.add("hidden");
  loadingScreen.classList.remove("hidden");
  try {
    loadingText.textContent = "Requesting camera…";
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    // Stylization runs at reduced resolution: faster, and chunkier strokes.
    const scale = Math.min(1, 640 / canvas.width);
    glCanvas.width = Math.round(canvas.width * scale);
    glCanvas.height = Math.round(canvas.height * scale);

    // Match the viewport box to the real camera aspect ratio, then fit on screen.
    document.getElementById("viewport").style
      .setProperty("--vp-ar", `${canvas.width} / ${canvas.height}`);
    fitWindow();

    initGL();
    await initTracking();

    loadingScreen.classList.add("hidden");
    requestAnimationFrame(drawFrame);
  } catch (err) {
    loadingScreen.classList.add("hidden");
    startScreen.classList.remove("hidden");
    showError(
      err.name === "NotAllowedError" || err.name === "NotFoundError"
        ? "AnimeCam could not access your camera. Please allow camera access and try again."
        : "AnimeCam has encountered a problem and needs to close.\n\n" + err.message
    );
  }
}

// ---------------------------------------------------------------- UI wiring
document.getElementById("btn-start").addEventListener("click", start);

document.querySelectorAll(".style-btn").forEach((btn) => {
  btn.addEventListener("click", () => setStyle(btn.dataset.style));
});

chkAutoMix.addEventListener("change", () => {
  statusStyle.textContent =
    `Style: ${STYLES[currentStyle].label}${chkAutoMix.checked ? " ★auto" : ""}`;
});

window.addEventListener("keydown", (e) => {
  const keys = { 1: "anime", 2: "manga", 3: "retro", 4: "oil" };
  if (keys[e.key]) setStyle(keys[e.key]);
});

// Manga window dressing ---------------------------------------------
function showError(msg) {
  errorText.textContent = msg;
  errorDialog.classList.remove("hidden");
  // center it
  errorDialog.style.left = "calc(50% - 185px)";
  errorDialog.style.top = "30%";
}

document.querySelectorAll("[data-close-dialog]").forEach((b) =>
  b.addEventListener("click", () => errorDialog.classList.add("hidden"))
);

// Size the window so the whole thing (chrome + video) fits on screen.
function fitWindow() {
  const win = document.getElementById("main-window");
  if (win.classList.contains("maximized")) return;
  const vp = document.getElementById("viewport");
  const ar = video.videoWidth ? canvas.width / canvas.height : 4 / 3;
  const chromeH = win.offsetHeight - vp.offsetHeight; // title/menu/toolbar/status
  const availH = window.innerHeight - 68 /* dock */ - 24 /* margin */;
  const maxW = Math.min(window.innerWidth * 0.97, 1100);
  const w = Math.max(280, Math.min(maxW, (availH - chromeH) * ar));
  win.style.width = w + "px";
}
window.addEventListener("resize", fitWindow);
fitWindow();

// Draggable main window via title bar
(function makeDraggable() {
  const win = document.getElementById("main-window");
  const bar = document.getElementById("title-bar");
  let drag = null;
  bar.addEventListener("mousedown", (e) => {
    if (e.target.closest(".tb-btn") || win.classList.contains("maximized")) return;
    const r = win.getBoundingClientRect();
    win.style.left = r.left + "px";
    win.style.top = r.top + "px";
    win.style.position = "absolute";
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    win.style.left = e.clientX - drag.dx + "px";
    win.style.top = e.clientY - drag.dy + "px";
  });
  window.addEventListener("mouseup", () => (drag = null));
})();

// Title-bar buttons
document.getElementById("btn-close").addEventListener("click", () => {
  showError("AnimeCam closed. Reload the page to restart.");
  document.getElementById("main-window").style.display = "none";
});
document.getElementById("btn-min").addEventListener("click", () => {
  const win = document.getElementById("main-window");
  win.style.display = "none";
  document.querySelector(".task-item").addEventListener(
    "click",
    () => (win.style.display = "flex"),
    { once: true }
  );
});
// Maximize = true fullscreen (falls back to fill-the-page where unsupported)
function setMaximized(on) {
  const win = document.getElementById("main-window");
  win.classList.toggle("maximized", on);
  if (on) {
    Object.assign(win.style, { left: "", top: "", position: "" });
  } else {
    win.style.width = "";
    fitWindow();
  }
}

document.getElementById("btn-max").addEventListener("click", async () => {
  const win = document.getElementById("main-window");
  const goingFull = !win.classList.contains("maximized");
  if (goingFull) {
    setMaximized(true);
    try { await document.documentElement.requestFullscreen(); } catch { /* iOS etc. */ }
  } else {
    setMaximized(false);
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* ignore */ }
    }
  }
});

// Esc / system exit from fullscreen restores the windowed layout
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) setMaximized(false);
});

// Double-click the title bar to toggle, like a real window manager
document.getElementById("title-bar").addEventListener("dblclick", (e) => {
  if (e.target.closest(".tb-btn")) return;
  document.getElementById("btn-max").click();
});

// Taskbar clock
function tickClock() {
  const d = new Date();
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  document.getElementById("clock").textContent =
    `${h}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}`;
}
tickClock();
setInterval(tickClock, 10_000);
