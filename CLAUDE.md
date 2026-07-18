# Project handoff / context for Claude

This file lets any Claude session (any account) continue this project from
where the last one left off. Read it fully before making changes.

## Who you're working with

The user (Alind) is a beginner with Terminal/git. Explain run steps
explicitly every time. Known recurring issue: they type commands while a
foreground process (`swift run` or `python3 -m http.server`) is still
running — always remind them to press **Ctrl+C and wait for the `%` prompt
first**, and to verify updates with `git log --oneline -1`.

## Repo layout — two projects in one repo

1. **AnimeCam** (repo root: `index.html`, `app.js`, `style.css`) — a web app
   that stylizes a hand-framed camera region (MediaPipe + WebGL). It also has
   a decorative in-page "MacBook notch" UI at the top (hover to expand).
   Status: done, merged, user is happy. Run: `python3 -m http.server 8080`.

2. **NotchBar** (`NotchBar/`) — the ACTIVE project. A native macOS menu-notch
   utility (Swift Package, SwiftUI + AppKit, no Xcode project). Turns the
   MacBook's hardware notch into a hover-expandable panel with recent apps
   and clipboard history. Build/run on the user's Mac only (macOS 13+):
   `cd NotchBar && swift run` (or `./make-app.sh` for a .app bundle).
   The Claude cloud environment is Linux — it CANNOT compile Swift; the user
   builds locally and reports back with screenshots.

## Git state

- Default branch: `claude/chat-session-bxkjlc` (this repo has no `main`).
- Working branch: `claude/macbook-notch-cursor-expand-ldkexk` — all NotchBar
  work lives here, pushed through commit `5ef4e16`. NOT yet merged to the
  default branch (PR #1 covered only the earlier AnimeCam web-notch work and
  was merged long ago; don't reuse it).
- Workflow: commit and push each user-visible iteration to the working
  branch; the user pulls and rebuilds locally.

## NotchBar architecture (NotchBar/Sources/NotchBar/)

- `main.swift` + `AppDelegate.swift` — accessory-mode app (no Dock icon),
  ✨ status-bar item with Quit menu.
- `NotchController.swift` — owns two borderless non-activating `NSPanel`s at
  `.statusBar` level: the notch panel and a small "status tab" panel.
  Detects real notch size via `safeAreaInsets.top` +
  `auxiliaryTopLeftArea/RightArea`; falls back to a 185×30 fake notch.
  Collapsed window = hardware notch + 12pt (6pt per side for the shape's
  ears). Expanded size is responsive: ~28% screen width / 25% height,
  clamped (420–560 / 220–280), recomputed on screen changes.
  CRITICAL animation fix: on expand, `setFrame` first, then flip
  `state.expanded` on the NEXT runloop turn (`DispatchQueue.main.async`) —
  flipping in the same tick causes a visible stutter. On collapse, shrink
  the window only after 0.6s so the spring settles.
- `NotchState.swift` — ObservableObject bridging AppKit↔SwiftUI:
  `expanded`, `collapsedSize`, `expandedSize`, `onHoverChange`.
- `NotchView.swift` — the shape + panel UI. `NotchShape` has concave top
  "ears" (cubic curves easing over ~1.8× the ear width — user explicitly
  wanted curved, non-abrupt sides) and convex bottom corners.
  Body: `.ultraThinMaterial` under a black gradient tint — opaque black when
  collapsed (blends with bezel), fading to 0.15 opacity at the bottom when
  expanded (glassmorphic; user asked for this look).
  Panel: header (title left, clock dead-center, power button top-right),
  "Recent Apps" row of 38pt glass icon tiles, clipboard list that is HIDDEN
  until something is copied (panel springs taller when the first item
  arrives). Horizontal content padding 40pt (24 eaten by the ear inset).
- `RecentAppsStore.swift` — seeds from running apps, keeps true recency
  order via NSWorkspace activation notifications; click tile = switch app.
- `ClipboardStore.swift` — polls NSPasteboard changeCount at 0.5s; last 24
  text snippets, click to re-copy. In-memory only (lost on restart).
- `StatusTabView.swift` — NEW, just added in `5ef4e16`, **not yet confirmed
  working by the user**: a notch-height black square hanging 6pt right of
  the notch with a pulsing green "LED" ball = app-is-active indicator.
  Hover opens the notch; it fades out while expanded (handled in
  NotchController via `tabPanel.animator().alphaValue`).

## Design decisions the user fought for (do not regress)

- Collapsed state must match the hardware notch EXACTLY (invisible).
- Opening must be smooth, from the top-center, minimal bounce
  (spring response 0.38, damping 0.92).
- Sides must be curved (eased ears), never straight/abrupt.
- Panel must be compact — they complained twice about excess height.
  Current: 240pt max, shorter when clipboard hidden.
- Glassmorphic expanded look; bigger app icons (38pt).
- REVERTED by user request: a Supaste-style three-stage "peek bar"
  (commit `be99753`, reverted in `54787ed`). Don't reintroduce unless asked.

## Immediate next step

Waiting on the user to build `5ef4e16` and confirm the green status tab
looks right (offered knobs: gap size, glow intensity/pulse speed, left vs
right side, pulse-only-on-activity).

## Backlog ideas (user hasn't committed to these)

- Persist clipboard history across restarts (user saw it reset; explained
  but not yet requested as a feature).
- Right-edge fade or fit-cap for the app-tile row (last icon gets clipped).
- Adaptive glass tint for legibility over bright backgrounds.
- File-drop shelf, media controls, battery/calendar peek, login item docs.
