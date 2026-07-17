import SwiftUI

/// Shared state between the AppKit window controller and the SwiftUI view.
final class NotchState: ObservableObject {
    @Published var expanded = false
    /// Size of the collapsed notch shape (real notch + a small strip hanging
    /// below it so there is something to hover on non-notch displays too).
    @Published var collapsedSize = CGSize(width: 205, height: 40)
    /// Set by the controller; the view reports hover changes through this.
    var onHoverChange: ((Bool) -> Void)?
}
