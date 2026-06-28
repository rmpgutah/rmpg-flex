import Foundation

// Binary store-and-forward for evidence photos captured in a dead zone. The
// JPEG is staged on disk (Caches/offline-photos) and a meta record holds the
// multipart fields; OfflineSync replays via MultipartUpload when signal returns.
struct QueuedPhoto: Codable, Identifiable {
    let id: UUID
    let filename: String
    let fields: [String: String]
    let label: String
    let queuedAt: Date
}

enum OfflinePhotoQueue {
    private static let metaKey = "offlinePhotoQueue.v1"

    private static var dir: URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("offline-photos", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    static func all() -> [QueuedPhoto] {
        guard let data = UserDefaults.standard.data(forKey: metaKey) else { return [] }
        return (try? JSONDecoder().decode([QueuedPhoto].self, from: data)) ?? []
    }

    static var count: Int { all().count }

    static func enqueue(jpeg: Data, fields: [String: String], label: String) {
        let id = UUID()
        let filename = "\(id.uuidString).jpg"
        try? jpeg.write(to: dir.appendingPathComponent(filename))
        var list = all()
        list.append(QueuedPhoto(id: id, filename: filename, fields: fields, label: label, queuedAt: Date()))
        save(list)
    }

    /// Replay queued photos in order; stop at the first transport failure.
    static func flush(using client: RMPGAPIClient) async -> (sent: [String], rejected: [String]) {
        var sent: [String] = [], rejected: [String] = []
        var remaining = all()
        while let item = remaining.first {
            let fileURL = dir.appendingPathComponent(item.filename)
            guard let jpeg = try? Data(contentsOf: fileURL) else {
                remaining.removeFirst(); save(remaining); continue   // file gone — drop meta
            }
            do {
                _ = try await MultipartUpload.upload(client, path: "api/field-photos", fields: item.fields, jpeg: jpeg)
                try? FileManager.default.removeItem(at: fileURL)
                sent.append(item.label)
                remaining.removeFirst()
            } catch where OfflineSyncLogic.shouldQueue(error) {
                break   // still offline
            } catch {
                try? FileManager.default.removeItem(at: fileURL)
                rejected.append("\(item.label): \(error.localizedDescription)")
                remaining.removeFirst()
            }
            save(remaining)
        }
        save(remaining)
        return (sent, rejected)
    }

    private static func save(_ list: [QueuedPhoto]) {
        if let data = try? JSONEncoder().encode(list) { UserDefaults.standard.set(data, forKey: metaKey) }
    }
}
