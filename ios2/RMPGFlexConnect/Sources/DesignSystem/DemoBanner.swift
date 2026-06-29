import SwiftUI

public struct DemoBanner: View {
    public init() {}

    public var body: some View {
        #if DEMO
        HStack(spacing: 8) {
            Image(systemName: "hammer.fill").font(.system(size: 10))
            Text("DEMO BUILD — NOT FOR PRODUCTION")
                .font(.system(size: 9, weight: .bold)).tracking(1)
        }
        .foregroundColor(.black).padding(.horizontal, 12).padding(.vertical, 4)
        .frame(maxWidth: .infinity).background(Color(hex: "d4a017"))
        #endif
    }
}
