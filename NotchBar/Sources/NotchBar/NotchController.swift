import AppKit
import SwiftUI

/// Owns the floating panel that sits over the physical notch. The panel is a
/// borderless, non-activating window pinned above the menu bar layer, so it
/// covers the notch area without stealing focus from whatever app is active.
final class NotchController {
    static let expandedSize = CGSize(width: 420, height: 280)

    let state = NotchState()
    let clipboard = ClipboardStore()

    private var panel: NSPanel
    private var collapseWork: DispatchWorkItem?

    init() {
        panel = NSPanel(
            contentRect: .zero,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .statusBar
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isMovable = false
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.acceptsMouseMovedEvents = true

        state.collapsedSize = Self.collapsedSize(for: targetScreen)
        state.onHoverChange = { [weak self] inside in
            if inside {
                self?.expand()
            } else {
                self?.scheduleCollapse()
            }
        }

        panel.contentView = NSHostingView(
            rootView: NotchView(state: state, clipboard: clipboard)
        )

        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in self?.reposition() }
    }

    func show() {
        reposition()
        panel.orderFrontRegardless()
    }

    // ------------------------------------------------------------- geometry

    /// Prefer the built-in display with a notch; fall back to the main screen.
    private var targetScreen: NSScreen? {
        NSScreen.screens.first { $0.safeAreaInsets.top > 0 }
            ?? NSScreen.main
            ?? NSScreen.screens.first
    }

    private static func notchSize(for screen: NSScreen?) -> CGSize {
        if let screen,
           screen.safeAreaInsets.top > 0,
           let left = screen.auxiliaryTopLeftArea,
           let right = screen.auxiliaryTopRightArea {
            return CGSize(
                width: screen.frame.width - left.width - right.width,
                height: screen.safeAreaInsets.top
            )
        }
        // No physical notch (older Mac / external display): draw a fake one.
        return CGSize(width: 185, height: 30)
    }

    private static func collapsedSize(for screen: NSScreen?) -> CGSize {
        let notch = notchSize(for: screen)
        // Hug the hardware notch tightly; just a sliver hangs below the bezel
        // as the hover target (the notch area itself is also hoverable).
        return CGSize(width: notch.width + 8, height: notch.height + 6)
    }

    private func frame(expanded: Bool) -> NSRect {
        guard let screen = targetScreen else { return .zero }
        let size = expanded ? Self.expandedSize : state.collapsedSize
        return NSRect(
            x: screen.frame.midX - size.width / 2,
            y: screen.frame.maxY - size.height,
            width: size.width,
            height: size.height
        )
    }

    private func reposition() {
        state.collapsedSize = Self.collapsedSize(for: targetScreen)
        panel.setFrame(frame(expanded: state.expanded), display: true)
    }

    // ---------------------------------------------------- expand / collapse

    private func expand() {
        collapseWork?.cancel()
        guard !state.expanded else { return }
        // Grow the window first (instantly, it's transparent), then let
        // SwiftUI spring the black shape out to fill it.
        panel.setFrame(frame(expanded: true), display: true)
        state.expanded = true
    }

    private func scheduleCollapse() {
        collapseWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.collapse() }
        collapseWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: work)
    }

    private func collapse() {
        guard state.expanded else { return }
        state.expanded = false
        // Shrink the window only after the shape animation has finished.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            guard let self, !self.state.expanded else { return }
            self.panel.setFrame(self.frame(expanded: false), display: true)
        }
    }
}
