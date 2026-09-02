import Foundation


/// Persists scan history to disk so it survives app relaunch — a prior
/// version kept `recentScans` as an in-memory `@Published` array only,
/// which meant every scan was lost the moment the app was backgrounded
/// long enough to be terminated, or force-quit. `ScannedID` has no image
/// data (photos aren't part of the model), so a small JSON file is simple
/// and appropriate — no need for Core Data or a database for a capped list.
public struct ScanHistoryStore {
    private let fileURL: URL
    private let maxEntries: Int

    public init(maxEntries: Int = 50) {
        self.maxEntries = maxEntries
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.fileURL = dir.appendingPathComponent("scan_history.json")
    }

    public func load() -> [ScannedID] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([ScannedID].self, from: data)) ?? []
    }

    public func save(_ scans: [ScannedID]) {
        let capped = Array(scans.prefix(maxEntries))
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(capped) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    /// Used by Settings' "Clear Scan History" action.
    public func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }
}
