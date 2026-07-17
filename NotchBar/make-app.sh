#!/bin/bash
# Builds NotchBar and wraps it into a double-clickable NotchBar.app bundle.
set -e
cd "$(dirname "$0")"

swift build -c release

APP=NotchBar.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp .build/release/NotchBar "$APP/Contents/MacOS/NotchBar"

cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>NotchBar</string>
    <key>CFBundleIdentifier</key>
    <string>com.alind.notchbar</string>
    <key>CFBundleName</key>
    <string>NotchBar</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
EOF

echo "Done. Move NotchBar.app to /Applications (or just double-click it here)."
