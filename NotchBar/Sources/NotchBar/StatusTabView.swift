import SwiftUI

/// The small square tab beside the hardware notch in the collapsed state:
/// notch-height, notch-styled corners, with a softly pulsing green ball that
/// signals NotchBar is active. Hovering it opens the notch too.
struct StatusTabView: View {
    @ObservedObject var state: NotchState
    @State private var pulsing = false

    var body: some View {
        NotchShape(topRadius: 4, bottomRadius: 8)
            .fill(Color.black)
            .overlay(
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color.white.opacity(0.9),
                                Color.green,
                                Color(red: 0, green: 0.45, blue: 0.1),
                            ],
                            center: UnitPoint(x: 0.35, y: 0.3),
                            startRadius: 0,
                            endRadius: 6
                        )
                    )
                    .frame(width: 8, height: 8)
                    .shadow(color: .green.opacity(0.9), radius: pulsing ? 6 : 2)
                    .scaleEffect(pulsing ? 1.1 : 0.9)
            )
            .onAppear {
                withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true)) {
                    pulsing = true
                }
            }
            .onHover { state.onHoverChange?($0) }
    }
}
