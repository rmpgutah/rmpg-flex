import UIKit

// Burns a court-ready metadata overlay into an evidence JPEG: a bottom data
// banner (timestamp / officer / GPS / case) + an RMPG EVIDENCE watermark, with a
// gold rule. The stored image IS the stamped exhibit — nothing to strip or
// dispute (unlike EXIF). Mirrors the desktop field-camera burn.
enum PhotoBurn {
    static func burn(_ image: UIImage, fields: BurnFields) -> UIImage {
        let size = image.size
        guard size.width > 0, size.height > 0 else { return image }
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = image.scale
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.image { ctx in
            image.draw(at: .zero)
            let lines = PhotoBurnLines.lines(fields)
            let fontSize = max(14, size.width * 0.022)
            let font = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .semibold)
            let pad = fontSize * 0.6
            let lineH = fontSize * 1.35
            let bannerH = lineH * CGFloat(lines.count) + pad * 2

            UIColor(white: 0, alpha: 0.55).setFill()
            ctx.fill(CGRect(x: 0, y: size.height - bannerH, width: size.width, height: bannerH))
            gold.setFill()
            ctx.fill(CGRect(x: 0, y: size.height - bannerH, width: size.width, height: max(2, fontSize * 0.12)))

            let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.white]
            var y = size.height - bannerH + pad
            for line in lines {
                (line as NSString).draw(at: CGPoint(x: pad, y: y), withAttributes: attrs)
                y += lineH
            }

            let wm = "RMPG EVIDENCE" as NSString
            let wmAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: fontSize, weight: .heavy),
                .foregroundColor: gold.withAlphaComponent(0.9),
            ]
            let wmSize = wm.size(withAttributes: wmAttrs)
            wm.draw(at: CGPoint(x: size.width - wmSize.width - pad, y: pad), withAttributes: wmAttrs)
        }
    }

    private static let gold = UIColor(red: 0xd4 / 255, green: 0xa0 / 255, blue: 0x17 / 255, alpha: 1)
}

extension BurnFields {
    /// Build the stamp from the current officer + GPS at capture time.
    static func current(unit: String = "", caseRef: String = "") -> BurnFields {
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd HH:mm:ss"
        var gps = ""
        if let loc = LocationManager.shared.last {
            gps = String(format: "%.5f, %.5f", loc.coordinate.latitude, loc.coordinate.longitude)
        }
        return BurnFields(timestamp: df.string(from: Date()),
                          officer: JWTClaims.current()?.name ?? "",
                          unit: unit, gps: gps, caseRef: caseRef)
    }
}
