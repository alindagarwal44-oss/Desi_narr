# NotchBar — your own MacBook notch utility

A tiny native macOS app that turns the notch into a hover-expandable control
panel, like NotchNook / The Boring Notch — but yours.

- **Collapsed**: a black shape hugging the physical notch, with a thin strip
  peeking below the bezel (that strip is the hover target).
- **Hover it**: springs open into a panel with a live clock and a
  **clipboard history** — the last 24 text snippets you copied anywhere on
  your Mac. Click any snippet to copy it back; `Clear` wipes the list.
- Works on Macs **without** a notch too (draws a small fake notch top-center),
  and on external displays.
- No Dock icon; a ✨ status-bar item has the Quit menu (or use the ⏻ button
  inside the panel).

## Build & run (on your Mac)

Requires macOS 13+ and the Xcode Command Line Tools
(`xcode-select --install` if you don't have them).

```bash
cd NotchBar
swift run            # build + run directly, or:
./make-app.sh        # builds NotchBar.app you can move to /Applications
```

First build takes a minute; after that it's instant.

## Start at login (optional)

System Settings → General → Login Items → “+” → pick `NotchBar.app`.

## How it works

- `NotchController.swift` — a borderless, non-activating `NSPanel` pinned at
  `.statusBar` window level so it draws over the menu-bar/notch area without
  stealing focus. The real notch size comes from `NSScreen.safeAreaInsets` +
  `auxiliaryTopLeftArea`/`auxiliaryTopRightArea`. On hover the window grows
  instantly (it's transparent) and SwiftUI springs the black shape out to
  fill it; on mouse-out it collapses after a short grace delay.
- `NotchView.swift` — the SwiftUI shape + expanded panel UI.
- `ClipboardStore.swift` — polls `NSPasteboard` change counts twice a second
  to build the history (macOS has no pasteboard-change notification).
- `AppDelegate.swift` / `main.swift` — accessory-mode app lifecycle and the
  status-bar Quit item.

## Ideas to add next

- Pin favorite snippets; persist history across launches
- File-drop shelf (drag files onto the notch)
- Now-playing / media controls
- Battery + calendar peek
