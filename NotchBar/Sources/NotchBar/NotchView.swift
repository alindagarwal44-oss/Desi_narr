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
            let height = expanded
                ? min(panelHeight, geo.size.height)
                : min(state.collapsedSize.height, geo.size.height)
            let shape = NotchShape(
                topRadius: expanded ? 24 : 6,
                bottomRadius: expanded ? 24 : 10
            )

            shape
                // Glassmorphic body: frosted material with a black tint that
                // is opaque when collapsed (to blend with the bezel) and
                // becomes translucent glass when expanded.
                .fill(.ultraThinMaterial)
                .overlay(
                    LinearGradient(
                        colors: [.black, .black.opacity(expanded ? 0.15 : 1)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .overlay(
                    shape.stroke(Color.white.opacity(expanded ? 0.14 : 0), lineWidth: 1)
                )
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
                .animation(.spring(response: 0.38, dampingFraction: 0.92), value: clipboard.items.isEmpty)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .onReceive(clock) { now = $0 }
    }

    // ------------------------------------------------------ expanded panel

    private var panel: some View {
        VStack(spacing: 8) {
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

            // Clipboard only appears once something has been copied.
            if clipboard.items.isEmpty {
                Spacer(minLength: 0)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    sectionLabel("Clipboard")
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
                                    .padding(.vertical, 6)
                                    .background(glass(cornerRadius: 10))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }

            HStack {
                if !clipboard.items.isEmpty {
                    Button("Clear") { clipboard.clear() }
                        .buttonStyle(.plain)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.secondary)
                }
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
        // Keep content below the physical notch, which occludes the top strip,
        // and inside the curved sides (24pt ear sweep + breathing room).
        .padding(.top, state.collapsedSize.height + 4)
        .padding(.horizontal, 34)
        .padding(.bottom, 12)
        .frame(
            width: NotchController.expandedSize.width,
            height: panelHeight,
            alignment: .top
        )
        .foregroundColor(.white)
    }

    /// Panel is shorter while the clipboard section is hidden.
    private var panelHeight: CGFloat {
        clipboard.items.isEmpty
            ? state.collapsedSize.height + 146
            : NotchController.expandedSize.height
    }

    private func sectionLabel(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.system(size: 9, weight: .bold))
            .kerning(1.1)
            .foregroundColor(.secondary)
    }
}

/// The notch outline. The top corners are concave "ears" that flare outward
/// into the screen edge — the same curve the hardware notch has — instead of
/// straight sides meeting the bezel at a hard angle. Bottom corners are
/// normal convex rounds.
struct NotchShape: Shape {
    var topRadius: CGFloat
    var bottomRadius: CGFloat

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(topRadius, bottomRadius) }
        set {
            topRadius = newValue.first
            bottomRadius = newValue.second
        }
    }

    func path(in rect: CGRect) -> Path {
        // The ear eases over ~1.8x its width so the transition from the
        // screen edge into the straight side is gradual, not an abrupt cut.
        let earH = min(topRadius * 1.8, (rect.height - bottomRadius) * 0.9)
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.minY))
        // top-left ear: long eased sweep from the screen edge into the side
        p.addCurve(
            to: CGPoint(x: rect.minX + topRadius, y: rect.minY + earH),
            control1: CGPoint(x: rect.minX + topRadius * 0.85, y: rect.minY),
            control2: CGPoint(x: rect.minX + topRadius, y: rect.minY + earH * 0.4)
        )
        p.addLine(to: CGPoint(x: rect.minX + topRadius, y: rect.maxY - bottomRadius))
        p.addQuadCurve(
            to: CGPoint(x: rect.minX + topRadius + bottomRadius, y: rect.maxY),
            control: CGPoint(x: rect.minX + topRadius, y: rect.maxY)
        )
        p.addLine(to: CGPoint(x: rect.maxX - topRadius - bottomRadius, y: rect.maxY))
        p.addQuadCurve(
            to: CGPoint(x: rect.maxX - topRadius, y: rect.maxY - bottomRadius),
            control: CGPoint(x: rect.maxX - topRadius, y: rect.maxY)
        )
        p.addLine(to: CGPoint(x: rect.maxX - topRadius, y: rect.minY + earH))
        // top-right ear, mirrored
        p.addCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY),
            control1: CGPoint(x: rect.maxX - topRadius, y: rect.minY + earH * 0.4),
            control2: CGPoint(x: rect.maxX - topRadius * 0.85, y: rect.minY)
        )
        p.closeSubpath()
        return p
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
                .frame(width: 38, height: 38)
                .padding(6)
                .background(glass(cornerRadius: 13))
        }
        .buttonStyle(.plain)
        .help(app.name)
        .scaleEffect(hovering ? 1.1 : 1)
        .animation(.spring(response: 0.25, dampingFraction: 0.7), value: hovering)
        .onHover { hovering = $0 }
    }
}
