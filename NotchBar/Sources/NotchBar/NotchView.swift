import SwiftUI
import Combine

/// The visible notch: a black shape with rounded bottom corners that hugs the
/// hardware notch when collapsed and springs out into a control panel on hover.
struct NotchView: View {
    @ObservedObject var state: NotchState
    @ObservedObject var clipboard: ClipboardStore
    @ObservedObject var recentApps: RecentAppsStore
    @State private var now = Date()

    private let clock = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    var body: some View {
        GeometryReader { geo in
            let expanded = state.expanded
            let width = expanded ? geo.size.width : min(state.collapsedSize.width, geo.size.width)
            let height = expanded ? geo.size.height : min(state.collapsedSize.height, geo.size.height)
            let radius: CGFloat = expanded ? 22 : 8
            let shape = UnevenRoundedRectangle(
                bottomLeadingRadius: radius,
                bottomTrailingRadius: radius,
                style: .continuous
            )

            shape
                .fill(Color.black)
                .overlay(alignment: .top) {
                    panel
                        .opacity(expanded ? 1 : 0)
                        .scaleEffect(expanded ? 1 : 0.94, anchor: .top)
                        .allowsHitTesting(expanded)
                        .animation(
                            expanded
                                ? .easeOut(duration: 0.2).delay(0.08)
                                : .easeIn(duration: 0.12),
                            value: expanded
                        )
                }
                .clipShape(shape)
                .frame(width: width, height: height)
                .onHover { state.onHoverChange?($0) }
                .animation(.spring(response: 0.38, dampingFraction: 0.92), value: expanded)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .onReceive(clock) { now = $0 }
    }

    // ------------------------------------------------------ expanded panel

    private var panel: some View {
        VStack(spacing: 10) {
            HStack {
                Image(systemName: "sparkles.rectangle.stack")
                    .foregroundColor(.cyan)
                Text("NotchBar")
                    .font(.system(size: 13, weight: .bold))
                Spacer()
                Text(now.formatted(date: .omitted, time: .shortened))
                    .font(.system(size: 12, weight: .semibold).monospacedDigit())
                    .foregroundColor(.secondary)
            }

            // Recent apps — frosted glass tiles, most recently used first.
            VStack(alignment: .leading, spacing: 6) {
                sectionLabel("Recent Apps")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(recentApps.apps) { app in
                            AppTile(app: app) { recentApps.open(app) }
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .leading, spacing: 6) {
                sectionLabel("Clipboard")
                if clipboard.items.isEmpty {
                    Text("Copy some text anywhere — it shows up here.")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background(glass(cornerRadius: 11))
                } else {
                    ScrollView {
                        LazyVStack(spacing: 6) {
                            ForEach(clipboard.items, id: \.self) { item in
                                Button {
                                    clipboard.copy(item)
                                } label: {
                                    HStack(spacing: 8) {
                                        Text(item)
                                            .font(.system(size: 12))
                                            .lineLimit(2)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                        Image(systemName: "doc.on.doc")
                                            .font(.system(size: 10))
                                            .foregroundColor(.secondary)
                                    }
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 7)
                                    .background(glass(cornerRadius: 10))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            HStack {
                Button("Clear") { clipboard.clear() }
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.secondary)
                Spacer()
                Button {
                    NSApp.terminate(nil)
                } label: {
                    Image(systemName: "power")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        // Keep content below the physical notch, which occludes the top strip.
        .padding(.top, state.collapsedSize.height + 8)
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
        .frame(
            width: NotchController.expandedSize.width,
            height: NotchController.expandedSize.height,
            alignment: .top
        )
        .foregroundColor(.white)
    }

    private func sectionLabel(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.system(size: 9, weight: .bold))
            .kerning(1.1)
            .foregroundColor(.secondary)
    }
}

/// Apple-style frosted glass: translucent material with a hairline border.
private func glass(cornerRadius: CGFloat) -> some View {
    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        .fill(.ultraThinMaterial)
        .overlay(
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
        )
}

/// One recent-app icon in a glass tile; lifts slightly on hover.
private struct AppTile: View {
    let app: RecentApp
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(nsImage: app.icon)
                .resizable()
                .interpolation(.high)
                .frame(width: 30, height: 30)
                .padding(6)
                .background(glass(cornerRadius: 11))
        }
        .buttonStyle(.plain)
        .help(app.name)
        .scaleEffect(hovering ? 1.1 : 1)
        .animation(.spring(response: 0.25, dampingFraction: 0.7), value: hovering)
        .onHover { hovering = $0 }
    }
}
