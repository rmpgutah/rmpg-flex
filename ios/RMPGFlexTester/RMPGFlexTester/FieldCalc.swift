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
        // Temperature: 32f / 0c
        if let f = num("f") { return String(format: "%.0f°F = %.1f°C", f, (f - 32) * 5 / 9) }
        if let cdeg = num("c") { return String(format: "%.0f°C = %.1f°F", cdeg, cdeg * 9 / 5 + 32) }
        // Drug/property weights: 28g / 1oz / 1lb
        if let g = num("g") { return String(format: "%.0f g = %.2f oz = %.3f lb", g, g / 28.3495, g / 453.592) }
        if let oz = num("oz") { return String(format: "%.1f oz = %.0f g (%.3f lb)", oz, oz * 28.3495, oz / 16) }
        // Distance: 100yd / 2mi / 12in
        if let yd = num("yd") { return String(format: "%.0f yd = %.0f ft = %.1f m", yd, yd * 3, yd * 0.9144) }
        if let mi = num("mi") { return String(format: "%.1f mi = %.0f ft = %.2f km", mi, mi * 5280, mi * 1.60934) }
        if let inch = num("in") { return String(format: "%.0f in = %.2f ft = %.1f cm", inch, inch / 12, inch * 2.54) }
        return nil
    }

    // ── BAC (Widmark): BAC = (oz·5.14 / (W·r)) − 0.015·hours ─────
    // Standard drink ≈ 0.6 oz pure ethanol; r = 0.73 (M) / 0.66 (F).
    static func bacWidmark(stdDrinks: Double, weightLbs: Double, male: Bool, hours: Double) -> Double {
        guard weightLbs > 0 else { return 0 }
        let r = male ? 0.73 : 0.66
        let raw = (stdDrinks * 0.6 * 5.14) / (weightLbs * r) - 0.015 * max(hours, 0)
        return max(0, raw)
    }
    /// Hours from a given BAC down to a target, at the 0.015/hr burn-off rate.
    static func hoursToReach(bac: Double, target: Double) -> Double {
        max(0, (bac - target) / 0.015)
    }

    // ── Stopping distance (ft): reaction + braking ──────────────
    // reaction = 1.47·mph·t (1.47 ft/s per mph); braking = mph² / (30·f).
    static func reactionDistanceFt(mph: Double, perceptionSec: Double = 1.5) -> Double {
        1.47 * mph * perceptionSec
    }
    static func brakingDistanceFt(mph: Double, dragFactor: Double) -> Double {
        guard dragFactor > 0 else { return 0 }
        return (mph * mph) / (30 * dragFactor)
    }
    static func totalStoppingFt(mph: Double, dragFactor: Double, perceptionSec: Double = 1.5) -> Double {
        reactionDistanceFt(mph: mph, perceptionSec: perceptionSec) + brakingDistanceFt(mph: mph, dragFactor: dragFactor)
    }

    /// Critical (minimum) speed from a yaw mark: S = 3.86·√(R·f). R in feet.
    static func criticalSpeedMph(radiusFt: Double, dragFactor: Double) -> Double {
        guard radiusFt > 0, dragFactor > 0 else { return 0 }
        return 3.86 * (radiusFt * dragFactor).squareRoot()
    }

    /// Speed from a known distance covered in a known time. ft + sec → mph.
    static func speedMph(distanceFt: Double, seconds: Double) -> Double {
        guard seconds > 0 else { return 0 }
        return (distanceFt / seconds) * 0.681818
    }

    /// 3-second following rule → feet of gap at a given speed.
    static func followingGapFt(mph: Double, seconds: Double = 3) -> Double {
        1.47 * mph * seconds
    }

    /// ETA in minutes to cover a distance at a speed. miles + mph → minutes.
    static func etaMinutes(miles: Double, mph: Double) -> Double {
        guard mph > 0 else { return 0 }
        return miles / mph * 60
    }

    // ── Decimal degrees ↔ DMS ───────────────────────────────────
    static func toDMS(_ value: Double, isLat: Bool) -> String {
        let hemi = isLat ? (value >= 0 ? "N" : "S") : (value >= 0 ? "E" : "W")
        let v = abs(value)
        let deg = Int(v)
        let minFull = (v - Double(deg)) * 60
        let min = Int(minFull)
        let sec = (minFull - Double(min)) * 60
        return String(format: "%d°%02d'%05.2f\"%@", deg, min, sec, hemi)
    }
    static func latLonToDMS(lat: Double, lon: Double) -> String {
        "\(toDMS(lat, isLat: true))  \(toDMS(lon, isLat: false))"
    }

    // ── Age + date math ─────────────────────────────────────────
    /// Whole years between a yyyy-MM-dd date of birth and `now`.
    static func age(dobISO: String, now: Date = Date()) -> Int? {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "UTC")
        guard let dob = f.date(from: String(dobISO.prefix(10))) else { return nil }
        return Calendar(identifier: .gregorian).dateComponents([.year], from: dob, to: now).year
    }
    /// Days between two yyyy-MM-dd dates (b − a). Negative if b precedes a.
    static func daysBetween(_ a: String, _ b: String) -> Int? {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "UTC")
        guard let da = f.date(from: String(a.prefix(10))), let db = f.date(from: String(b.prefix(10))) else { return nil }
        return Calendar(identifier: .gregorian).dateComponents([.day], from: da, to: db).day
    }

    // ── Glasgow Coma Scale ──────────────────────────────────────
    static func glasgow(eye: Int, verbal: Int, motor: Int) -> (total: Int, severity: String)? {
        guard (1...4).contains(eye), (1...5).contains(verbal), (1...6).contains(motor) else { return nil }
        let t = eye + verbal + motor
        let sev = t >= 13 ? "Minor" : t >= 9 ? "Moderate" : "Severe (≤8: secure airway)"
        return (t, sev)
    }

    /// Utah speeding fine estimate (typical bail schedule) by mph over limit.
    static func speedFineUSD(mphOver: Int) -> String {
        switch mphOver {
        case ..<1: return "At/under limit — no fine"
        case 1...10: return "$120"
        case 11...15: return "$150"
        case 16...20: return "$200"
        case 21...25: return "$270"
        case 26...30: return "$370"
        default: return "Mandatory court appearance (31+ over)"
        }
    }

    /// Sum a free-form list of dollar amounts ("120, 45.50, $1,200") → total.
    /// Splits on whitespace/+ (not comma) so thousands separators survive;
    /// strips $ and , from each token before parsing.
    static func sumAmounts(_ s: String) -> Double {
        s.split(whereSeparator: { $0 == " " || $0 == "+" || $0 == "\n" })
            .compactMap { tok -> Double? in
                Double(tok.replacingOccurrences(of: "$", with: "")
                          .replacingOccurrences(of: ",", with: ""))
            }
            .reduce(0, +)
    }
}
