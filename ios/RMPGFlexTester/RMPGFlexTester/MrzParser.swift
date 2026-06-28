import Foundation

// ICAO 9303 MRZ parser for passports (TD3, 2×44) and ID cards (TD1, 3×30).
// Pure Foundation — verifiable via the SwiftPM /tmp harness. Produces the
// same AamvaResult shape as the DL barcode parser so the relay, warrant
// check, FI prefill, and result UI all reuse the existing pipeline.
enum MrzParser {

    // ── Check digit (ICAO 9303 §4.9): weights 7,3,1; A=10…Z=35, '<'=0 ──
    static func checkDigit(_ s: Substring) -> Int? {
        let weights = [7, 3, 1]
        var sum = 0
        for (i, ch) in s.enumerated() {
            let v: Int
            switch ch {
            case "0"..."9": v = Int(String(ch))!
            case "A"..."Z": v = Int(ch.asciiValue! - Character("A").asciiValue!) + 10
            case "<": v = 0
            default: return nil
            }
            sum += v * weights[i % 3]
        }
        return sum % 10
    }

    private static func digitMatches(_ data: Substring, _ cd: Character) -> Bool {
        guard let d = cd.wholeNumberValue, let computed = checkDigit(data) else { return false }
        return d == computed
    }

    /// Extract candidate MRZ lines from raw OCR text: uppercase, strip spaces
    /// (OCR loves inserting them), keep only [A-Z0-9<] lines of MRZ width.
    static func candidateLines(_ text: String) -> [String] {
        text.uppercased()
            .components(separatedBy: .newlines)
            .map { $0.replacingOccurrences(of: " ", with: "")
                     .replacingOccurrences(of: "«", with: "<<") }
            .filter { line in
                (line.count == 44 || line.count == 30) &&
                line.allSatisfy { ("A"..."Z").contains($0) || $0.isNumber || $0 == "<" }
            }
    }

    /// YYMMDD → YYYY-MM-DD. `futureBiased` (expiry) resolves the century
    /// forward; DOBs resolve so the person isn't born in the future.
    static func isoDate(_ yymmdd: Substring, futureBiased: Bool, now: Date = Date()) -> String? {
        guard yymmdd.count == 6, yymmdd.allSatisfy(\.isNumber) else { return nil }
        let yy = Int(yymmdd.prefix(2))!
        let mm = String(yymmdd.dropFirst(2).prefix(2))
        let dd = String(yymmdd.suffix(2))
        guard let m = Int(mm), (1...12).contains(m), let d = Int(dd), (1...31).contains(d) else { return nil }
        let currentYY = Calendar.current.component(.year, from: now) % 100
        let century: Int
        if futureBiased {
            century = yy <= currentYY + 15 ? 2000 : 1900
        } else {
            century = yy <= currentYY ? 2000 : 1900
        }
        return String(format: "%04d-%@-%@", century + yy, mm, dd)
    }

    private static func names(from nameField: Substring) -> (last: String, first: String) {
        let parts = nameField.components(separatedBy: "<<")
        let clean = { (s: String) in
            s.replacingOccurrences(of: "<", with: " ")
                .trimmingCharacters(in: .whitespaces).capitalized
        }
        let last = clean(parts.first ?? "")
        let first = clean(parts.count > 1 ? parts[1] : "")
        return (last, first)
    }

    private static let sexMap = ["M": "Male", "F": "Female", "X": "X", "<": "Unspecified"]

    // ── Parse: tries TD3 (passport) then TD1 (ID card) ──────────
    static func parse(_ text: String) -> AamvaResult? {
        let lines = candidateLines(text)
        if let r = parseTD3(lines) { return r }
        return parseTD1(lines)
    }

    private static func parseTD3(_ lines: [String]) -> AamvaResult? {
        guard let l1 = lines.first(where: { $0.count == 44 && $0.hasPrefix("P") }) else { return nil }
        // Data line: 44 chars, starts with the document number, position 9 is
        // its check digit — find the line (not l1) whose doc check digit holds.
        guard let l2 = lines.first(where: { line in
            line.count == 44 && line != l1 &&
            digitMatches(line.prefix(9), line[line.index(line.startIndex, offsetBy: 9)])
        }) else { return nil }

        var r = AamvaResult()
        r.raw = l1 + "\n" + l2
        var f: [String: String] = ["doc_type": "passport"]

        f["issuing_country"] = String(l1.dropFirst(2).prefix(3)).replacingOccurrences(of: "<", with: "")
        let (last, first) = names(from: l1.dropFirst(5))
        if !last.isEmpty { f["last_name"] = last }
        if !first.isEmpty { f["first_name"] = first }

        func seg(_ start: Int, _ len: Int) -> Substring {
            let s = l2.index(l2.startIndex, offsetBy: start)
            return l2[s..<l2.index(s, offsetBy: len)]
        }
        f["document_number"] = String(seg(0, 9)).replacingOccurrences(of: "<", with: "")
        f["nationality"] = String(seg(10, 3)).replacingOccurrences(of: "<", with: "")
        var checksOK = true
        if digitMatches(seg(13, 6), l2[l2.index(l2.startIndex, offsetBy: 19)]) {
            f["date_of_birth"] = isoDate(seg(13, 6), futureBiased: false)
        } else { checksOK = false }
        f["gender"] = sexMap[String(seg(20, 1))]
        if digitMatches(seg(21, 6), l2[l2.index(l2.startIndex, offsetBy: 27)]) {
            f["dl_expiry"] = isoDate(seg(21, 6), futureBiased: true)
        } else { checksOK = false }
        // Composite check: doc(0-9) + dob(13-19) + expiry+personal(21-42) vs char 43
        let composite = String(seg(0, 10)) + String(seg(13, 7)) + String(seg(21, 22))
        if !digitMatches(Substring(composite), l2[l2.index(l2.startIndex, offsetBy: 43)]) { checksOK = false }
        f["mrz_checks"] = checksOK ? "valid" : "FAILED"

        r.fields = f.compactMapValues { $0 }
        return r
    }

    private static func parseTD1(_ lines: [String]) -> AamvaResult? {
        let short = lines.filter { $0.count == 30 }
        guard short.count >= 3,
              let l1 = short.first(where: { $0.hasPrefix("I") || $0.hasPrefix("A") || $0.hasPrefix("C") })
        else { return nil }
        guard let i1 = short.firstIndex(of: l1), short.count > i1 + 2 else { return nil }
        let l2 = short[i1 + 1], l3 = short[i1 + 2]

        var r = AamvaResult()
        r.raw = [l1, l2, l3].joined(separator: "\n")
        var f: [String: String] = ["doc_type": "id_card"]

        func seg(_ line: String, _ start: Int, _ len: Int) -> Substring {
            let s = line.index(line.startIndex, offsetBy: start)
            return line[s..<line.index(s, offsetBy: len)]
        }
        f["issuing_country"] = String(seg(l1, 2, 3)).replacingOccurrences(of: "<", with: "")
        let doc = seg(l1, 5, 9)
        guard digitMatches(doc, l1[l1.index(l1.startIndex, offsetBy: 14)]) else { return nil }
        f["document_number"] = String(doc).replacingOccurrences(of: "<", with: "")

        var checksOK = true
        if digitMatches(seg(l2, 0, 6), l2[l2.index(l2.startIndex, offsetBy: 6)]) {
            f["date_of_birth"] = isoDate(seg(l2, 0, 6), futureBiased: false)
        } else { checksOK = false }
        f["gender"] = sexMap[String(seg(l2, 7, 1))]
        if digitMatches(seg(l2, 8, 6), l2[l2.index(l2.startIndex, offsetBy: 14)]) {
            f["dl_expiry"] = isoDate(seg(l2, 8, 6), futureBiased: true)
        } else { checksOK = false }
        f["nationality"] = String(seg(l2, 15, 3)).replacingOccurrences(of: "<", with: "")
        f["mrz_checks"] = checksOK ? "valid" : "FAILED"

        let (last, first) = names(from: Substring(l3))
        if !last.isEmpty { f["last_name"] = last }
        if !first.isEmpty { f["first_name"] = first }

        r.fields = f.compactMapValues { $0 }
        return r
    }

    /// Officer-facing alerts: expired doc, under-21, failed MRZ integrity.
    static func alerts(_ r: AamvaResult, now: Date = Date()) -> [String] {
        var out = AamvaParser.alerts(r, now: now).map {
            $0.replacingOccurrences(of: "LICENSE EXPIRED", with: "DOCUMENT EXPIRED")
        }
        if r.fields["mrz_checks"] == "FAILED" {
            out.append("MRZ CHECK DIGITS FAILED — re-scan or inspect document")
        }
        return out
    }
}
