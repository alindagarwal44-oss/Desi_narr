import AppKit

/// Watches the system pasteboard and keeps a short history of text snippets.
/// Polling the change count is the standard approach — macOS has no
/// pasteboard-changed notification.
final class ClipboardStore: ObservableObject {
    @Published private(set) var items: [String] = []

    private var lastChange = NSPasteboard.general.changeCount
    private var timer: Timer?
    private let maxItems = 24

    init() {
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            self?.poll()
        }
    }

    private func poll() {
        let pb = NSPasteboard.general
        guard pb.changeCount != lastChange else { return }
        lastChange = pb.changeCount
        guard let text = pb.string(forType: .string)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !text.isEmpty
        else { return }
        items.removeAll { $0 == text }
        items.insert(text, at: 0)
        if items.count > maxItems {
            items.removeLast(items.count - maxItems)
        }
    }

    func copy(_ text: String) {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(text, forType: .string)
        // Adopt the new change count so our own write isn't re-ingested.
        lastChange = pb.changeCount
    }

    func clear() {
        items.removeAll()
    }
}
