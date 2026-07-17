import SwiftUI

enum NotchMode {
    case collapsed  // invisible, hugging the hardware notch
    case peek       // compact bar on hover: icon, title, chevron
    case open       // full panel: recent apps + clipboard
}

/// Shared state between the AppKit window controller and the SwiftUI view.
final class NotchState: ObservableObject {
    @Published var mode: NotchMode = .collapsed
    /// Size of the collapsed notch shape (matches the hardware notch, or a
    /// small drawn notch on displays without one).
    @Published var collapsedSize = CGSize(width: 205, height: 40)
    /// Expanded panel size, scaled to the current screen by the controller.
    @Published var expandedSize = CGSize(width: 470, height: 240)
    /// Set by the controller; the view reports hover changes through this.
    var onHoverChange: ((Bool) -> Void)?
    /// Set by the controller; the view asks to go from peek to open.
    var onOpen: (() -> Void)?
}
