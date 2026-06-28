import Foundation

// Pure decisions for offline store-and-forward. Foundation-only (unit-tested).
enum OfflineSyncLogic {
    /// True when an error is a connectivity failure worth queueing for later —
    /// vs. a real server answer (an HTTP status) that retrying won't fix, or a
    /// user cancellation.
    static func shouldQueue(_ error: Error) -> Bool {
        let ns = error as NSError
        guard ns.domain == NSURLErrorDomain else { return false }
        let offlineCodes: Set<Int> = [
            NSURLErrorNotConnectedToInternet,
            NSURLErrorNetworkConnectionLost,
            NSURLErrorTimedOut,
            NSURLErrorCannotConnectToHost,
            NSURLErrorCannotFindHost,
            NSURLErrorDNSLookupFailed,
            NSURLErrorDataNotAllowed,
            NSURLErrorInternationalRoamingOff,
        ]
        return offlineCodes.contains(ns.code)
    }

    /// One-line summary of a flush result for the UI.
    static func summary(sent: Int, rejected: Int) -> String {
        if sent == 0 && rejected == 0 { return "Nothing to sync" }
        var s = "✓ \(sent) sent"
        if rejected > 0 { s += " · ✗ \(rejected) rejected" }
        return s
    }
}
