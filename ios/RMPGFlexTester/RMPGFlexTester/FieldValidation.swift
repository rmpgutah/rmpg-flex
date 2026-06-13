import Foundation

enum FieldValidation {
    static func isValidDate(_ s: String) -> Bool {
        s.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
    }
    static func isNonNegativeNumber(_ s: String) -> Bool {
        guard let n = Double(s) else { return false }
        return n >= 0
    }
}
