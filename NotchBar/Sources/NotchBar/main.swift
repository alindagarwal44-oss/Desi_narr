import AppKit

// Accessory policy: no Dock icon, no menu bar takeover — the app lives
// entirely in the notch window plus a small status-bar item for quitting.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
