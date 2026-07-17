import SwiftUI
import Combine

/// The visible notch: a black shape with rounded bottom corners that hugs the
/// hardware notch when collapsed and springs out into a control panel on hover.
struct NotchView: View {
    @ObservedObject var state: NotchState
    @ObservedObject var clipboard: ClipboardStore
    @State private var now = Date()

    private let clock = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    var body: some View {
        GeometryReader { geo in
            let expanded = state.expanded
            let width = expanded ? geo.size.width : min(state.collapsedSize.width, geo.size.width)
            let height = expanded ? geo.size.height : min(state.collapsedSize.height, geo.size.height)
            let radius: CGFloat = expanded ? 22 : 9
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

            if clipboard.items.isEmpty {
                Spacer()
                Text("Copy some text anywhere —\nyour clipboard history shows up here.")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                Spacer()
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
                                .background(
                                    Color.white.opacity(0.07),
                                    in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

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
        .padding(.top, state.collapsedSize.height + 2)
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
        .frame(
            width: NotchController.expandedSize.width,
            height: NotchController.expandedSize.height,
            alignment: .top
        )
        .foregroundColor(.white)
    }
}
