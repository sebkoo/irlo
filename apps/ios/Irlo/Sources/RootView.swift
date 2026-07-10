import SwiftUI

/// Stage 0 placeholder — the Deck feed replaces this in Stage 1+ (ADR-0008).
struct RootView: View {
    /// Stable hook for UI and snapshot tests; never derive from display text.
    static let accessibilityID = "root.placeholder"

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "figure.walk.motion")
                .font(.system(size: 56))
                .accessibilityHidden(true)
            Text("Irlo")
                .font(.largeTitle.bold())
            Text("Swipe into real life.")
                .font(.title3)
                .foregroundStyle(.secondary)
        }
        .accessibilityIdentifier(Self.accessibilityID)
    }
}

#Preview {
    RootView()
}
