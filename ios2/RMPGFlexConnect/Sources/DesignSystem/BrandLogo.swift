import SwiftUI

/// The RMPG Flex seal — used system-wide (launch screen, lock screen, login)
/// instead of a generic SF Symbol placeholder, matching the App Icon. The
/// asset lives in the app target's Assets.xcassets; SwiftUI's `Image(_:)`
/// resolves by name from the main bundle regardless of which module calls it.
public struct BrandLogo: View {
    let size: CGFloat

    public init(size: CGFloat) {
        self.size = size
    }

    public var body: some View {
        Image("AppLogo")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(Circle())
    }
}
