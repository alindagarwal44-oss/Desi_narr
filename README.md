# AnimeCam.exe — Finger Frame Studio

A Windows XP–styled web app that turns the region you frame with your fingers
into a live anime-style preview.

Hold **both hands** up to the camera. Your two thumbs and two index fingertips
become the four corners of a quadrilateral mask — everything inside it is
stylized in real time, everything outside stays normal video.
If only one hand (or none) is visible, the mask does not form.

## Styles

| Key | Style     | Look                                              |
|-----|-----------|---------------------------------------------------|
| 1   | Anime     | Vibrant cel-shading, posterized colors, ink edges |
| 2   | Manga     | Black & white, layered cross-hatching, ink lines  |
| 3   | Retro     | Muted warm palette, soft posterization            |
| 4   | Oil Paint | Kuwahara-filtered painterly strokes               |

## Run it

No build step. Serve the folder over HTTP (camera access requires a secure
context; `localhost` counts):

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Click **Start Camera**, allow camera access, and frame something with your hands.

- **Auto mix** checkbox: while the mask is active, styles switch randomly every
  ~1–2 s. A quick head shake forces an instant switch (with a speed-line burst).
  Picking a style manually pauses auto mix.
- **Trackers** checkbox: animated fingertip reticles, hand skeletons, and a
  head-tilt indicator.
- **Notch**: a MacBook-style notch sits at the top of the screen. Bring the
  cursor near it and it leans out; hover it and it expands into a quick-control
  panel — style switcher, auto-mix toggle, live hand/FPS stats, and a clock.
  Its rim glows cyan while the finger-frame mask is active. On touch screens,
  tap to open, tap elsewhere to close.
- **Head motion**: head tilt rotates the manga screentone and oil brush
  direction; head position shifts the anime/retro palette.
- **`?demo` URL flag** (`http://localhost:8080/?demo`): forces a static mask so
  you can preview styles without hand tracking.

## How it works

- **Hand tracking** — [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
  `HandLandmarker` (full model, GPU delegate), loaded from CDN.
  Thumb tip = landmark 4, index tip = landmark 8, two hands required.
- **Mask** — the 4 fingertips are sorted by angle around their centroid so the
  quad never self-intersects, exponentially smoothed to reduce jitter, and used
  as a canvas clip path.
- **Stylization** — two-pass WebGL: an edge-preserving bilateral smoothing pass
  (clean cel regions), then a per-style pass with XDoG ink lines (anime/manga/
  retro) or an 8-sector generalized Kuwahara (oil). A FaceLandmarker feeds head
  tilt/position/speed into the shaders as uniforms. The whole scene is mirrored
  so it behaves like a mirror.

## Files

```
index.html   – XP window chrome, toolbar, taskbar
style.css    – Luna theme styling
app.js       – camera, hand tracking, quad math, WebGL shaders, UI
```

## Offline / air-gapped use (optional)

The app loads MediaPipe from CDN, but automatically falls back to a local
`vendor/` directory if the CDN is unreachable. To make it fully offline:

```bash
npm install @mediapipe/tasks-vision@0.10.14
mkdir -p vendor/tasks-vision vendor/models
cp node_modules/@mediapipe/tasks-vision/vision_bundle.mjs vendor/tasks-vision/
cp -r node_modules/@mediapipe/tasks-vision/wasm vendor/tasks-vision/
curl -L -o vendor/models/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
```
