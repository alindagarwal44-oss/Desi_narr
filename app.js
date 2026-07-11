/* AnimeCam — finger-framed real-time stylization
 * Hand tracking: MediaPipe Tasks Vision (HandLandmarker)
 * Stylization: WebGL fragment shaders, composited into the
 * quadrilateral formed by both thumbs + index fingertips.
 */

// MediaPipe is loaded at startup: CDN first, local vendor/ fallback (see initHandTracking).
const MP_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MP_VENDOR = "./vendor/tasks-vision";
const MODEL_CDN =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const MODEL_VENDOR = "./vendor/models/hand_landmarker.task";

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

// Shared helpers injected into fragment shaders.
const FRAG_COMMON = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float sobel(vec2 uv) {
  float tl = lum(texture2D(u_tex, uv + u_texel * vec2(-1.0,  1.0)).rgb);
  float tc = lum(texture2D(u_tex, uv + u_texel * vec2( 0.0,  1.0)).rgb);
  float tr = lum(texture2D(u_tex, uv + u_texel * vec2( 1.0,  1.0)).rgb);
  float ml = lum(texture2D(u_tex, uv + u_texel * vec2(-1.0,  0.0)).rgb);
  float mr = lum(texture2D(u_tex, uv + u_texel * vec2( 1.0,  0.0)).rgb);
  float bl = lum(texture2D(u_tex, uv + u_texel * vec2(-1.0, -1.0)).rgb);
  float bc = lum(texture2D(u_tex, uv + u_texel * vec2( 0.0, -1.0)).rgb);
  float br = lum(texture2D(u_tex, uv + u_texel * vec2( 1.0, -1.0)).rgb);
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  return length(vec2(gx, gy));
}`;

const STYLES = {
  anime: {
    label: "Anime",
    frag: FRAG_COMMON + `
void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb;
  float l = lum(c);
  c = clamp(mix(vec3(l), c, 1.45), 0.0, 1.0);   // saturation boost
  c = floor(c * 6.0 + 0.5) / 6.0;               // cel posterize
  c = pow(c, vec3(0.92));                       // slight lift
  float e = sobel(v_uv);
  float ink = smoothstep(0.28, 0.55, e);
  c = mix(c, vec3(0.05, 0.04, 0.08), ink * 0.9);
  gl_FragColor = vec4(c, 1.0);
}`,
  },

  manga: {
    label: "Manga",
    frag: FRAG_COMMON + `
void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb;
  float g = pow(lum(c), 0.85);
  vec2 p = gl_FragCoord.xy;
  float paper = 1.0;
  // layered cross-hatching by tone
  if (g < 0.78) paper = min(paper, step(2.2, mod(p.x + p.y, 9.0)));
  if (g < 0.55) paper = min(paper, step(2.2, mod(p.x - p.y, 9.0)));
  if (g < 0.34) paper = min(paper, step(2.2, mod(p.x + p.y + 4.5, 9.0)));
  if (g < 0.16) paper = 0.0;
  float e = sobel(v_uv);
  if (e > 0.32) paper = 0.0;                    // ink outlines
  vec3 inkCol = vec3(0.07, 0.07, 0.09);
  vec3 paperCol = vec3(0.97, 0.96, 0.93);
  gl_FragColor = vec4(mix(inkCol, paperCol, paper), 1.0);
}`,
  },

  retro: {
    label: "Retro",
    frag: FRAG_COMMON + `
void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb;
  float l = lum(c);
  c = mix(vec3(l), c, 0.72);                    // desaturate
  c = floor(c * 5.0 + 0.5) / 5.0;               // gentle posterize
  c = c * vec3(1.08, 1.0, 0.86) + vec3(0.05, 0.035, 0.0); // warm cast
  float e = sobel(v_uv);
  float ink = smoothstep(0.35, 0.7, e);
  c = mix(c, vec3(0.25, 0.2, 0.14), ink * 0.65);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
  },

  oil: {
    label: "Oil Paint",
    frag: FRAG_COMMON + `
const int RADIUS = 4;
void main() {
  // Kuwahara filter: pick the sector with least variance
  vec3 mean0 = vec3(0.0); vec3 sq0 = vec3(0.0);
  vec3 mean1 = vec3(0.0); vec3 sq1 = vec3(0.0);
  vec3 mean2 = vec3(0.0); vec3 sq2 = vec3(0.0);
  vec3 mean3 = vec3(0.0); vec3 sq3 = vec3(0.0);
  float n = float((RADIUS + 1) * (RADIUS + 1));

  for (int i = 0; i <= RADIUS; i++) {
    for (int j = 0; j <= RADIUS; j++) {
      vec3 c;
      c = texture2D(u_tex, v_uv + u_texel * vec2(float(-i), float(-j))).rgb;
      mean0 += c; sq0 += c * c;
      c = texture2D(u_tex, v_uv + u_texel * vec2(float(i), float(-j))).rgb;
      mean1 += c; sq1 += c * c;
      c = texture2D(u_tex, v_uv + u_texel * vec2(float(-i), float(j))).rgb;
      mean2 += c; sq2 += c * c;
      c = texture2D(u_tex, v_uv + u_texel * vec2(float(i), float(j))).rgb;
      mean3 += c; sq3 += c * c;
    }
  }

  mean0 /= n; mean1 /= n; mean2 /= n; mean3 /= n;
  float v0 = dot(sq0 / n - mean0 * mean0, vec3(1.0));
  float v1 = dot(sq1 / n - mean1 * mean1, vec3(1.0));
  float v2 = dot(sq2 / n - mean2 * mean2, vec3(1.0));
  float v3 = dot(sq3 / n - mean3 * mean3, vec3(1.0));

  vec3 c = mean0;
  float minV = v0;
  if (v1 < minV) { minV = v1; c = mean1; }
  if (v2 < minV) { minV = v2; c = mean2; }
  if (v3 < minV) { minV = v3; c = mean3; }

  c = clamp(mix(vec3(lum(c)), c, 1.2) * vec3(1.05, 1.0, 0.92), 0.0, 1.0);
  gl_FragColor = vec4(c, 1.0);
}`,
  },
};

// ---------------------------------------------------------------- WebGL pipeline
const glCanvas = document.createElement("canvas");
const gl = glCanvas.getContext("webgl", { premultipliedAlpha: false });
const programs = {};
let videoTexture = null;

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
  return p;
}

function initGL() {
  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  for (const [key, style] of Object.entries(STYLES)) {
    const p = buildProgram(style.frag);
    const loc = gl.getAttribLocation(p, "a_pos");
    programs[key] = {
      program: p,
      aPos: loc,
      uTexel: gl.getUniformLocation(p, "u_texel"),
    };
  }

  videoTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, videoTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
}

function renderStylized(styleKey) {
  const { program, aPos, uTexel } = programs[styleKey];
  gl.viewport(0, 0, glCanvas.width, glCanvas.height);
  gl.useProgram(program);
  gl.bindTexture(gl.TEXTURE_2D, videoTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
  gl.uniform2f(uTexel, 1 / glCanvas.width, 1 / glCanvas.height);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ---------------------------------------------------------------- Hand tracking
let handLandmarker = null;

async function initHandTracking() {
  loadingText.textContent = "Loading hand tracking model…";

  let base = MP_CDN;
  let mp;
  try {
    mp = await import(`${MP_CDN}/vision_bundle.mjs`);
  } catch {
    base = MP_VENDOR;
    mp = await import(`${MP_VENDOR}/vision_bundle.mjs`);
  }

  const vision = await mp.FilesetResolver.forVisionTasks(`${base}/wasm`);
  const options = (modelPath) => ({
    baseOptions: { modelAssetPath: modelPath, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  try {
    handLandmarker = await mp.HandLandmarker.createFromOptions(vision, options(MODEL_CDN));
  } catch {
    handLandmarker = await mp.HandLandmarker.createFromOptions(vision, options(MODEL_VENDOR));
  }
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

// ---------------------------------------------------------------- Render loop
let currentStyle = "anime";
let lastVideoTime = -1;
let latestLandmarks = [];
let frames = 0;
let fpsTimer = performance.now();

function drawFrame() {
  if (video.readyState < 2) {
    requestAnimationFrame(drawFrame);
    return;
  }

  // Run detection once per new video frame.
  if (handLandmarker && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = handLandmarker.detectForVideo(video, performance.now());
    latestLandmarks = result.landmarks || [];
  }

  const W = canvas.width;
  const H = canvas.height;
  const quad = updateQuad(latestLandmarks);

  ctx.save();
  // Mirror everything (video + landmark space) so it behaves like a mirror.
  ctx.translate(W, 0);
  ctx.scale(-1, 1);

  ctx.drawImage(video, 0, 0, W, H);

  if (quad) {
    renderStylized(currentStyle);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(quad[0].x, quad[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(quad[i].x, quad[i].y);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(glCanvas, 0, 0, W, H);
    ctx.restore();

    // Quad border — ink pen: solid black under dashed white
    ctx.beginPath();
    ctx.moveTo(quad[0].x, quad[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(quad[i].x, quad[i].y);
    ctx.closePath();
    ctx.strokeStyle = "rgba(17, 17, 17, 0.95)";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Debug trackers
  if (chkDebug.checked) {
    for (const lm of latestLandmarks) {
      for (const tip of [THUMB_TIP, INDEX_TIP]) {
        const x = lm[tip].x * W;
        const y = lm[tip].y * H;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = tip === THUMB_TIP ? "#ffd54f" : "#4fc3f7";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  ctx.restore();

  // Status bar
  statusHands.textContent = `Hands: ${Math.min(latestLandmarks.length, 2)}/2`;
  statusMask.textContent = quad ? "Mask: ACTIVE" : "Mask: inactive";

  frames++;
  const now = performance.now();
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
    glCanvas.width = canvas.width;
    glCanvas.height = canvas.height;

    initGL();
    await initHandTracking();

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

function setStyle(key) {
  if (!STYLES[key]) return;
  currentStyle = key;
  statusStyle.textContent = `Style: ${STYLES[key].label}`;
  document.querySelectorAll(".style-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.style === key)
  );
}

window.addEventListener("keydown", (e) => {
  const keys = { 1: "anime", 2: "manga", 3: "retro", 4: "oil" };
  if (keys[e.key]) setStyle(keys[e.key]);
});

// XP window dressing ------------------------------------------------
function showError(msg) {
  errorText.textContent = msg;
  errorDialog.classList.remove("hidden");
  // center it
  errorDialog.style.left = "calc(50% - 180px)";
  errorDialog.style.top = "30%";
}

document.querySelectorAll("[data-close-dialog]").forEach((b) =>
  b.addEventListener("click", () => errorDialog.classList.add("hidden"))
);

// Draggable main window via title bar
(function makeDraggable() {
  const win = document.getElementById("main-window");
  const bar = document.getElementById("title-bar");
  let drag = null;
  bar.addEventListener("mousedown", (e) => {
    if (e.target.closest(".tb-btn")) return;
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

// Title-bar buttons (cosmetic-ish, XP flavor)
document.getElementById("btn-close").addEventListener("click", () => {
  showError("It is now safe to turn off your computer.\n(Reload the page to restart AnimeCam.)");
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
document.getElementById("btn-max").addEventListener("click", () => {
  const win = document.getElementById("main-window");
  win.classList.toggle("maximized");
  if (win.classList.contains("maximized")) {
    Object.assign(win.style, { left: "0", top: "0", width: "100vw" });
  } else {
    Object.assign(win.style, { left: "", top: "", width: "" });
  }
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
