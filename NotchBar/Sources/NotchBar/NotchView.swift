import SwiftUI
import Combine

/// The visible notch. Three stages:
/// - collapsed: black shape hugging the hardware notch, invisible
/// - peek (hover): compact solid-black bar — icon, title, chevron
/// - open (click): full glass panel — recent apps + clipboard
struct NotchView: View {
    @ObservedObject var state: NotchState
    @ObservedObject var clipboard: ClipboardStore
    @ObservedObject var recentApps: RecentAppsStore
    @State private var now = Date()

    private let clock = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    var body: some View {
        GeometryReader { geo in
            let mode = state.mode
            let size = shapeSize(in: geo.size)
            let shape = NotchShape(
                topRadius: mode == .collapsed ? 6 : 24,
                bottomRadius: mode == .collapsed ? 10 : (mode == .peek ? 18 : 24)
            )

            shape
                // Frosted material under a black tint: fully black when
                // collapsed and peeking (Supaste-style solid bar), turning to
                // translucent glass only in the open panel.
                .fill(.ultraThinMaterial)
                .overlay(
                    LinearGradient(
                        colors: [.black, .black.opacity(mode == .open ? 0.15 : 1)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .overlay(
                    shape.stroke(
                        Color.white.opacity(mode == .collapsed ? 0 : 0.14),
                        lineWidth: 1
                    )
                )
                .overlay(alignment: .top) {
                    peekRow
                        .opacity(mode == .peek ? 1 : 0)
                        .allowsHitTesting(mode == .peek)
                        .animation(.easeOut(duration: 0.15), value: mode)
                }
                .overlay(alignment: .top) {
                    panel
                        .opacity(mode == .open ? 1 : 0)
                        .scaleEffect(mode == .open ? 1 : 0.96, anchor: .top)
                        .allowsHitTesting(mode == .open)
                        .animation(
                            mode == .open
                                ? .easeOut(duration: 0.2).delay(0.08)
                                : .easeIn(duration: 0.12),
                            value: mode
                        )
                }
                .clipShape(shape)
                .frame(width: size.width, height: size.height)
                .contentShape(shape)
                .onHover { state.onHoverChange?($0) }
                .onTapGesture {
                    if state.mode == .peek { state.onOpen?() }
                }
                .animation(.spring(response: 0.38, dampingFraction: 0.92), value: mode)
                .animation(.spring(response: 0.38, dampingFraction: 0.92), value: clipboard.items.isEmpty)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .onReceive(clock) { now = $0 }
    }

    private func shapeSize(in avail: CGSize) -> CGSize {
        switch state.mode {
        case .collapsed:
            return CGSize(
                width: min(state.collapsedSize.width, avail.width),
                height: min(state.collapsedSize.height, avail.height)
            )
        case .peek:
            return CGSize(
                width: min(peekWidth, avail.width),
                height: min(state.collapsedSize.height + 52, avail.height)
            )
        case .open:
            return CGSize(width: avail.width, height: min(panelHeight, avail.height))
        }
    }

    private var peekWidth: CGFloat {
        min(state.collapsedSize.width + 240, state.expandedSize.width)
    }

    // ------------------------------------------------------------- peek bar

    private var peekRow: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(LinearGradient(colors: [.cyan, .blue], startPoint: .top, endPoint: .bottom))
                .frame(width: 30, height: 30)
                .overlay(
                    Image(systemName: "sparkles.rectangle.stack")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white)
                )
            VStack(alignment: .leading, spacing: 1) {
                Text("NotchBar")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(.white)
                Text("Recent apps & clipboard")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }
            Spacer()
            Button {
                state.onOpen?()
            } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.white.opacity(0.85))
                    .frame(width: 26, height: 26)
                    .background(Circle().fill(Color.white.opacity(0.12)))
            }
            .buttonStyle(.plain)
        }
        .padding(.top, state.collapsedSize.height + 8)
        .padding(.horizontal, 40)
        .frame(width: peekWidth, alignment: .center)
    }

    // ------------------------------------------------------ expanded panel

    private var panel: some View {
        VStack(spacing: 8) {
            ZStack {
                HStack {
                    Image(systemName: "sparkles.rectangle.stack")
                        .foregroundColor(.cyan)
                    Text("NotchBar")
                        .font(.system(size: 13, weight: .bold))
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

                HStack {
                    Button("Clear") { clipboard.clear() }
                        .buttonStyle(.plain)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.secondary)
                    Spacer()
                }
            }
        }
        // Keep content below the physical notch, which occludes the top strip.
        // Horizontal: the curved sides inset the glass body by 24pt, so 40pt
        // total leaves ~16pt of visible breathing room inside the edge.
        .padding(.top, state.collapsedSize.height + 4)
        .padding(.horizontal, 40)
        .padding(.bottom, 14)
        .frame(
            width: state.expandedSize.width,
            height: panelHeight,
            alignment: .top
        )
        .foregroundColor(.white)
    }

    /// Panel is shorter while the clipboard section (and its footer) is hidden.
    private var panelHeight: CGFloat {
        clipboard.items.isEmpty
            ? state.collapsedSize.height + 122
            : state.expandedSize.height
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
