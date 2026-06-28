import Foundation

// ============================================================
// VehicleFunctions — Swift port of the shared vehicle/unit bridge
// ============================================================
// Mirrors client/src/utils/vehicleFunctions.ts: VIN validate/decode
// (ISO-3779 check digit, year code, WMI country), plate validation,
// NCIC color/make codes, and the evaluateVehicle bridge. Foundation-only.
// ============================================================

struct VehicleEvaluation {
    var vinValid = false
    var vinError = ""
    var decodedYear: Int?
    var plateValid = false
    var color = ""
    var make = ""
    var category = ""
    var age: Int?
    var classic = false
    var descriptor = ""
    var key = ""
}

enum VehicleFunctions {

    static let ncicColors: [String: String] = [
        "BLK": "Black", "BLU": "Blue", "BRO": "Brown", "GLD": "Gold", "GRY": "Gray",
        "GRN": "Green", "MAR": "Maroon", "ONG": "Orange", "PNK": "Pink", "PLE": "Purple",
        "RED": "Red", "SIL": "Silver", "TAN": "Tan", "TEA": "Teal", "WHI": "White",
        "YEL": "Yellow", "BGE": "Beige", "BRZ": "Bronze",
    ]

    static let ncicMakes: [String: String] = [
        "FORD": "Ford", "CHEV": "Chevrolet", "GMC": "GMC", "DODG": "Dodge", "CHRY": "Chrysler",
        "JEEP": "Jeep", "RAM": "RAM", "TOYT": "Toyota", "HOND": "Honda", "NISS": "Nissan",
        "MAZD": "Mazda", "SUBA": "Subaru", "HYUN": "Hyundai", "KIA": "Kia", "VOLK": "Volkswagen",
        "BMW": "BMW", "MERZ": "Mercedes-Benz", "AUDI": "Audi", "TESL": "Tesla", "LEXS": "Lexus",
    ]

    // VIN transliteration + weights (ISO 3779).
    private static let translit: [Character: Int] = [
        "A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6, "G": 7, "H": 8, "J": 1, "K": 2, "L": 3, "M": 4,
        "N": 5, "P": 7, "R": 9, "S": 2, "T": 3, "U": 4, "V": 5, "W": 6, "X": 7, "Y": 8, "Z": 9,
        "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
    ]
    private static let weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
    private static let yearCodes: [Character: Int] = [
        "A": 1980, "B": 1981, "C": 1982, "D": 1983, "E": 1984, "F": 1985, "G": 1986, "H": 1987,
        "J": 1988, "K": 1989, "L": 1990, "M": 1991, "N": 1992, "P": 1993, "R": 1994, "S": 1995,
        "T": 1996, "V": 1997, "W": 1998, "X": 1999, "Y": 2000,
        "1": 2001, "2": 2002, "3": 2003, "4": 2004, "5": 2005, "6": 2006, "7": 2007, "8": 2008, "9": 2009,
    ]

    static func normalizeVIN(_ vin: String) -> String {
        vin.replacingOccurrences(of: "\\s", with: "", options: .regularExpression).uppercased()
    }

    static func vinCheckDigit(_ vin: String) -> String {
        let v = Array(normalizeVIN(vin))
        guard v.count == 17 else { return "" }
        var sum = 0
        for i in 0..<17 {
            guard let t = translit[v[i]] else { return "" }
            sum += t * weights[i]
        }
        let r = sum % 11
        return r == 10 ? "X" : String(r)
    }

    static func isValidVIN(_ vin: String) -> Bool {
        let v = normalizeVIN(vin)
        guard v.range(of: "^[A-HJ-NPR-Z0-9]{17}$", options: .regularExpression) != nil else { return false }
        let cd = vinCheckDigit(v)
        return !cd.isEmpty && cd == String(Array(v)[8])
    }

    static func vinValidationError(_ vin: String) -> String {
        let v = normalizeVIN(vin)
        if v.count != 17 { return "Length \(v.count), expected 17" }
        if v.range(of: "^[A-HJ-NPR-Z0-9]+$", options: .regularExpression) == nil { return "Contains I, O, Q or illegal characters" }
        if vinCheckDigit(v) != String(Array(v)[8]) { return "Check digit mismatch" }
        return ""
    }

    static func vinCountry(_ vin: String) -> String {
        guard let first = normalizeVIN(vin).first else { return "Unknown" }
        if "12345".contains(first) { return "United States" }
        if "JKLMNPR".contains(first) { return "Asia" }
        if "STUVWXYZ".contains(first) { return "Europe" }
        if "67".contains(first) { return "Oceania" }
        if "89".contains(first) { return "South America" }
        return "Unknown"
    }

    static func vinModelYear(_ vin: String, now: Date = Date()) -> Int? {
        let v = Array(normalizeVIN(vin))
        guard v.count >= 10, var base = yearCodes[v[9]] else { return nil }
        let yr = Calendar(identifier: .gregorian).component(.year, from: now)
        while base + 30 <= yr + 1 { base += 30 }
        return base
    }

    static func normalizePlate(_ plate: String) -> String {
        plate.replacingOccurrences(of: "[\\s-]", with: "", options: .regularExpression).uppercased()
    }

    static func validatePlate(state: String, plate: String) -> Bool {
        let p = normalizePlate(plate)
        let formats = ["CA": "^[0-9][A-Z]{3}[0-9]{3}$", "TX": "^[A-Z]{3}[0-9]{4}$",
                       "UT": "^[A-Z0-9]{1,7}$", "NV": "^[0-9]{3}[A-Z]{3}$"]
        guard let pat = formats[state.uppercased()] else { return p.range(of: "^[A-Z0-9]{1,8}$", options: .regularExpression) != nil }
        return p.range(of: pat, options: .regularExpression) != nil
    }

    static func expandColor(_ code: String) -> String { ncicColors[code.uppercased()] ?? code }
    static func expandMake(_ code: String) -> String { ncicMakes[code.uppercased()] ?? code }

    static func vehicleAge(_ year: Int, now: Date = Date()) -> Int? {
        guard year >= 1900 else { return nil }
        return max(0, Calendar(identifier: .gregorian).component(.year, from: now) - year)
    }

    static func vehicleCategory(_ body: String) -> String {
        switch body.uppercased() {
        case "MC": return "motorcycle"
        case "TR", "TL", "BU": return "heavy"
        case "PK", "VN", "UT": return "light truck"
        case "MH": return "rv"
        default: return "passenger"
        }
    }

    /// Single bridge call — desktop's evaluateVehicle equivalent.
    static func evaluateVehicle(vin: String?, plate: String?, state: String?, year: Int?,
                                color: String?, make: String?, bodyStyle: String?,
                                now: Date = Date()) -> VehicleEvaluation {
        var e = VehicleEvaluation()
        if let vin = vin, !vin.isEmpty {
            e.vinValid = isValidVIN(vin)
            e.vinError = vinValidationError(vin)
            e.decodedYear = vinModelYear(vin, now: now)
            e.key = "VIN:\(normalizeVIN(vin))"
        } else if let plate = plate {
            e.key = "PLATE:\((state ?? "").uppercased()):\(normalizePlate(plate))"
        }
        if let plate = plate { e.plateValid = validatePlate(state: state ?? "", plate: plate) }
        e.color = expandColor(color ?? "")
        e.make = expandMake(make ?? "")
        e.category = vehicleCategory(bodyStyle ?? "")
        let resolvedYear = year ?? e.decodedYear
        if let y = resolvedYear { e.age = vehicleAge(y, now: now); e.classic = (vehicleAge(y, now: now) ?? 0) >= 25 }
        e.descriptor = [resolvedYear.map { String($0) }, e.color.isEmpty ? nil : e.color,
                        e.make.isEmpty ? nil : e.make].compactMap { $0 }.joined(separator: " ")
        return e
    }
}
