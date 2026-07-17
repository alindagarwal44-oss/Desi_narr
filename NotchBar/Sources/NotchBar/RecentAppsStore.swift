import AppKit

struct RecentApp: Identifiable, Equatable {
    let id: pid_t
    let name: String
    let icon: NSImage

    static func == (lhs: RecentApp, rhs: RecentApp) -> Bool { lhs.id == rhs.id }
}

/// Tracks the most recently used regular apps. Seeded from the running-app
/// list (newest launch first), then kept in true recency order by watching
/// app-activation notifications. No permissions or private APIs needed.
final class RecentAppsStore: ObservableObject {
    @Published private(set) var apps: [RecentApp] = []

    private let maxApps = 8
    private var observers: [NSObjectProtocol] = []

    init() {
        let running = NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular }
            .sorted { ($0.launchDate ?? .distantPast) > ($1.launchDate ?? .distantPast) }
        apps = Array(running.compactMap(Self.entry).prefix(maxApps))

        let nc = NSWorkspace.shared.notificationCenter
        observers.append(nc.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard
                let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                app.activationPolicy == .regular,
                let entry = Self.entry(app)
            else { return }
            self?.bump(entry)
        })
        observers.append(nc.addObserver(
            forName: NSWorkspace.didTerminateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            else { return }
            self?.apps.removeAll { $0.id == app.processIdentifier }
        })
    }

    deinit {
        let nc = NSWorkspace.shared.notificationCenter
        observers.forEach { nc.removeObserver($0) }
    }

    private static func entry(_ app: NSRunningApplication) -> RecentApp? {
        guard let name = app.localizedName else { return nil }
        let icon = app.icon
            ?? NSImage(systemSymbolName: "app.fill", accessibilityDescription: nil)
            ?? NSImage()
        return RecentApp(id: app.processIdentifier, name: name, icon: icon)
    }

    private func bump(_ entry: RecentApp) {
        apps.removeAll { $0 == entry }
        apps.insert(entry, at: 0)
        if apps.count > maxApps {
            apps.removeLast(apps.count - maxApps)
        }
    }

    func open(_ app: RecentApp) {
        NSRunningApplication(processIdentifier: app.id)?
            .activate(options: [.activateIgnoringOtherApps])
    }
}
