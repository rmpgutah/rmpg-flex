import Foundation

// Pure field-calculation helpers backing the FIELD CALC toolkit tools.
// No UIKit/CoreLocation — verifiable via the SwiftPM /tmp harness.
enum FieldCalc {

    // ── Phonetic speller (APCO law-enforcement + NATO) ──────────
    static let apco: [Character: String] = [
        "A": "Adam", "B": "Boy", "C": "Charles", "D": "David", "E": "Edward",
        "F": "Frank", "G": "George", "H": "Henry", "I": "Ida", "J": "John",
        "K": "King", "L": "Lincoln", "M": "Mary", "N": "Nora", "O": "Ocean",
        "P": "Paul", "Q": "Queen", "R": "Robert", "S": "Sam", "T": "Tom",
        "U": "Union", "V": "Victor", "W": "William", "X": "X-ray", "Y": "Young",
        "Z": "Zebra",
    ]
    static let nato: [Character: String] = [
        "A": "Alfa", "B": "Bravo", "C": "Charlie", "D": "Delta", "E": "Echo",
        "F": "Foxtrot", "G": "Golf", "H": "Hotel", "I": "India", "J": "Juliett",
        "K": "Kilo", "L": "Lima", "M": "Mike", "N": "November", "O": "Oscar",
        "P": "Papa", "Q": "Quebec", "R": "Romeo", "S": "Sierra", "T": "Tango",
        "U": "Uniform", "V": "Victor", "W": "Whiskey", "X": "X-ray", "Y": "Yankee",
        "Z": "Zulu",
    ]
    private static let digits: [Character: String] = [
        "0": "Zero", "1": "One", "2": "Two", "3": "Three", "4": "Four",
        "5": "Five", "6": "Six", "7": "Seven", "8": "Eight", "9": "Niner",
    ]

    static func phonetic(_ text: String, alphabet: [Character: String] = apco) -> String {
        text.uppercased().compactMap { ch -> String? in
            if let w = alphabet[ch] { return w }
            if let d = digits[ch] { return d }
            if ch == " " { return "·" }
            if ch == "-" { return "DASH" }
            return nil
        }.joined(separator: " ")
    }

    // ── Skid-distance speed estimate: S = √(30·d·f) ─────────────
    // d in feet, f = drag factor. Minimum speed — actual was higher
    // (assumes full skid to stop on level grade).
    static let dragFactors: [(surface: String, f: Double)] = [
        ("Dry asphalt", 0.75), ("Wet asphalt", 0.50), ("Dry concrete", 0.80),
        ("Wet concrete", 0.60), ("Gravel", 0.55), ("Packed snow", 0.30),
        ("Ice", 0.15),
    ]

    static func skidSpeedMph(distanceFeet: Double, dragFactor: Double) -> Double {
        guard distanceFeet > 0, dragFactor > 0 else { return 0 }
        return (30.0 * distanceFeet * dragFactor).squareRoot()
    }

    // ── Haversine distance + initial bearing ────────────────────
    static func distanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let r = 6_371_000.0
        let p1 = lat1 * .pi / 180, p2 = lat2 * .pi / 180
        let dp = (lat2 - lat1) * .pi / 180, dl = (lon2 - lon1) * .pi / 180
        let a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        return r * 2 * atan2(a.squareRoot(), (1 - a).squareRoot())
    }

    static func bearingDegrees(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let p1 = lat1 * .pi / 180, p2 = lat2 * .pi / 180
        let dl = (lon2 - lon1) * .pi / 180
        let y = sin(dl) * cos(p2)
        let x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl)
        let deg = atan2(y, x) * 180 / .pi
        return (deg + 360).truncatingRemainder(dividingBy: 360)
    }

    static func compassPoint(_ bearing: Double) -> String {
        let pts = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                   "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
        return pts[Int((bearing / 22.5).rounded()) % 16]
    }

    /// "40.7608, -111.8910" → (lat, lon). Tolerates spaces/parens.
    static func parseLatLon(_ s: String) -> (Double, Double)? {
        let cleaned = s.replacingOccurrences(of: "(", with: "")
            .replacingOccurrences(of: ")", with: "")
        let parts = cleaned.split(whereSeparator: { $0 == "," || $0 == " " })
            .compactMap { Double($0) }
        guard parts.count == 2, abs(parts[0]) <= 90, abs(parts[1]) <= 180 else { return nil }
        return (parts[0], parts[1])
    }

    // ── Sunrise / sunset (Almanac for Computers / NOAA, zenith 90.833°,
    //    civil twilight 96°). Returns minutes after UTC midnight. ──
    static func sunTimeUTCMinutes(dayOfYear: Int, lat: Double, lon: Double,
                                  sunrise: Bool, zenith: Double = 90.833) -> Double? {
        func d2r(_ d: Double) -> Double { d * .pi / 180 }
        func r2d(_ r: Double) -> Double { r * 180 / .pi }
        func norm(_ v: Double, _ m: Double) -> Double {
            var x = v.truncatingRemainder(dividingBy: m)
            if x < 0 { x += m }
            return x
        }
        let lngHour = lon / 15
        let t = Double(dayOfYear) + (((sunrise ? 6.0 : 18.0) - lngHour) / 24)
        let m = (0.9856 * t) - 3.289
        let l = norm(m + (1.916 * sin(d2r(m))) + (0.020 * sin(2 * d2r(m))) + 282.634, 360)
        var ra = norm(r2d(atan(0.91764 * tan(d2r(l)))), 360)
        // Align right ascension into the same quadrant as L, then → hours.
        ra += (floor(l / 90) * 90 - floor(ra / 90) * 90)
        ra /= 15
        let sinDec = 0.39782 * sin(d2r(l))
        let cosDec = cos(asin(sinDec))
        let cosH = (cos(d2r(zenith)) - (sinDec * sin(d2r(lat)))) / (cosDec * cos(d2r(lat)))
        guard cosH <= 1, cosH >= -1 else { return nil }  // polar day/night
        let h = (sunrise ? 360 - r2d(acos(cosH)) : r2d(acos(cosH))) / 15
        let tt = h + ra - (0.06571 * t) - 6.622
        let ut = norm(tt - lngHour, 24)
        return ut * 60
    }

    // ── Unit conversions (passport MRZ docs are metric) ─────────
    static func cmToFeetInches(_ cm: Double) -> String {
        let totalIn = cm / 2.54
        let ft = Int(totalIn / 12)
        let inch = Int((totalIn - Double(ft) * 12).rounded())
        if inch == 12 { return "\(ft + 1)'0\"" }
        return "\(ft)'\(inch)\""
    }
    static func kgToLbs(_ kg: Double) -> Int { Int((kg * 2.20462).rounded()) }
    static func kmhToMph(_ kmh: Double) -> Int { Int((kmh * 0.621371).rounded()) }

    /// Convert a free-form field entry: "180cm", "75kg", "100kmh", "5'11".
    static func convert(_ input: String) -> String? {
        let s = input.lowercased().replacingOccurrences(of: " ", with: "")
        func num(_ suffix: String) -> Double? {
            guard s.hasSuffix(suffix) else { return nil }
            return Double(s.dropLast(suffix.count))
        }
        if let cm = num("cm") { return "\(Int(cm)) cm = \(cmToFeetInches(cm))" }
        if let kg = num("kg") { return "\(Int(kg)) kg = \(kgToLbs(kg)) lbs" }
        if let lb = num("lb") ?? num("lbs") { return "\(Int(lb)) lbs = \(Int((lb / 2.20462).rounded())) kg" }
        if let k = num("kmh") ?? num("km/h") { return "\(Int(k)) km/h = \(kmhToMph(k)) mph" }
        if let mph = num("mph") { return "\(Int(mph)) mph = \(Int((mph / 0.621371).rounded())) km/h" }
        if let m = num("m") { return String(format: "%.0f m = %.0f ft", m, m * 3.28084) }
        if let ft = num("ft") { return String(format: "%.0f ft = %.1f m", ft, ft / 3.28084) }
        // 5'11 or 5'11" → cm
        let heightParts = s.replacingOccurrences(of: "\"", with: "").split(separator: "'")
        if heightParts.count == 2, let f = Double(heightParts[0]), let i = Double(heightParts[1]) {
            let cm = (f * 12 + i) * 2.54
            return "\(Int(f))'\(Int(i))\" = \(Int(cm.rounded())) cm"
        }
        return nil
    }
}
