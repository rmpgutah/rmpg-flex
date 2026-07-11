import Foundation

/// Plain-English labels for AAMVA DL/ID Card Design Standard element codes —
/// the same public specification AAMVAParser itself is built from, not
/// proprietary/derived third-party data. Lets the "Advanced — Raw Scan Data"
/// screen show "Document Number: T64235789" instead of a bare "DAQT64235789"
/// line, which meant reading the raw barcode data required already knowing
/// the AAMVA spec by heart.
public enum AAMVAFieldLabels {
    public static let labels: [String: String] = [
        "DAA": "Full Name",
        "DAB": "Last Name",
        "DAC": "First Name",
        "DAD": "Middle Name",
        "DAE": "Name Suffix",
        "DAF": "Name Prefix",
        "DAG": "Address — Street 1",
        "DAH": "Address — Street 2",
        "DAI": "City",
        "DAJ": "State/Jurisdiction",
        "DAK": "Postal Code",
        "DAL": "Address — Street 1",
        "DAM": "Address — Street 2",
        "DAN": "City",
        "DAO": "State",
        "DAP": "Postal Code",
        "DAQ": "Document Number",
        "DAR": "License Classification",
        "DAS": "Restriction Codes",
        "DAT": "Endorsement Codes",
        "DAU": "Height",
        "DAV": "Weight Range",
        "DAW": "Weight (lbs)",
        "DAX": "Weight (kg)",
        "DAY": "Eye Color",
        "DAZ": "Hair Color",
        "DBA": "Expiration Date",
        "DBB": "Date of Birth",
        "DBC": "Sex/Gender",
        "DBD": "Issue Date",
        "DBE": "Issue Timestamp",
        "DBF": "Number of Duplicates",
        "DBG": "Medical Indicator Codes",
        "DBH": "Organ Donor Indicator",
        "DBI": "Non-Resident Indicator",
        "DBJ": "Unique Customer ID",
        "DBK": "Social Security Number",
        "DBM": "Audit Information",
        "DBN": "Alias — Last Name",
        "DBO": "Alias — First Name",
        "DBP": "Alias — Suffix",
        "DBR": "Name Suffix",
        "DBS": "Permit Classification",
        "DCA": "Vehicle Class",
        "DCB": "Restriction Codes",
        "DCD": "Endorsement Codes",
        "DCE": "Weight Range",
        "DCF": "Document Discriminator",
        "DCG": "Country",
        "DCH": "Federal Commercial Vehicle Codes",
        "DCI": "Place of Birth",
        "DCJ": "Audit Information",
        "DCK": "Inventory Control Number",
        "DCL": "Race/Ethnicity",
        "DCM": "Standard Vehicle Classification",
        "DCN": "Standard Endorsement Code",
        "DCO": "Standard Restriction Code",
        "DCP": "Vehicle Classification Description",
        "DCQ": "Endorsement Description",
        "DCR": "Restriction Description",
        "DCS": "Last Name",
        "DCT": "Given Names",
        "DCU": "Name Suffix",
        "DDA": "Compliance Type (REAL ID)",
        "DDB": "Card Revision Date",
        "DDC": "HazMat Endorsement Expiration",
        "DDD": "Limited Duration Document",
        "DDE": "Last Name Truncated",
        "DDF": "First Name Truncated",
        "DDG": "Middle Name Truncated",
        "DDH": "Under 18 Until",
        "DDI": "Under 19 Until",
        "DDJ": "Under 21 Until",
        "DDK": "Organ Donor",
        "DDL": "Veteran",
    ]

    /// Formats one raw barcode line ("DAQT64235789") as "Document Number: T64235789".
    /// Unrecognized codes and non-conforming lines pass through unchanged
    /// rather than guessing — an honest "we don't recognize this" beats a
    /// confidently wrong label.
    public static func describe(_ rawLine: String) -> String {
        let trimmed = rawLine.trimmingCharacters(in: .whitespaces)
        guard trimmed.count > 3 else { return trimmed }
        let code = String(trimmed.prefix(3))
        guard let label = labels[code] else { return trimmed }
        let value = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
        return value.isEmpty ? "\(label) [\(code)]" : "\(label): \(value)"
    }
}
