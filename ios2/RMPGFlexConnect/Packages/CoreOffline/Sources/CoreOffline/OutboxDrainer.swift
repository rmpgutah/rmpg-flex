import Foundation
import SwiftData

public actor OutboxDrainer {
    private let modelContainer: ModelContainer
    private let apiBaseURL: URL
    private let tokenProvider: @Sendable () -> String?

    public init(modelContainer: ModelContainer, apiBaseURL: URL, tokenProvider: @escaping @Sendable () -> String?) {
        self.modelContainer = modelContainer
        self.apiBaseURL = apiBaseURL
        self.tokenProvider = tokenProvider
    }

    public func drainBatch(maxEntries: Int = 20) async -> DrainResult {
        let context = ModelContext(modelContainer)
        var descriptor = FetchDescriptor<OutboxEntry>(
            predicate: #Predicate { !$0.isFailed && $0.attemptCount < 10 },
            sortBy: [SortDescriptor(\.createdAt, order: .forward)]
        )
        descriptor.fetchLimit = maxEntries

        guard let entries = try? context.fetch(descriptor), !entries.isEmpty else {
            return .noWork
        }

        var sent = 0
        var failed = 0

        for entry in entries {
            do {
                try await send(entry)
                context.delete(entry)
                sent += 1
            } catch {
                entry.attemptCount += 1
                entry.lastError = error.localizedDescription
                if entry.attemptCount >= 10 {
                    entry.isFailed = true
                }
                failed += 1
            }
        }
        try? context.save()
        return .partial(sent: sent, failed: failed)
    }

    private func send(_ entry: OutboxEntry) async throws {
        guard let url = URL(string: entry.endpoint, relativeTo: apiBaseURL) else {
            throw OutboxError.invalidURL(entry.endpoint)
        }
        var request = URLRequest(url: url)
        request.httpMethod = entry.method
        request.setValue(entry.idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        if let token = tokenProvider() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        for (key, value) in entry.headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        if let body = entry.body {
            request.httpBody = body
            if request.value(forHTTPHeaderField: "Content-Type") == nil {
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
        }
        if let attachment = entry.attachmentData {
            let boundary = UUID().uuidString
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            var multipart = Data()
            multipart.append("--\(boundary)\r\n".data(using: .utf8)!)
            multipart.append("Content-Disposition: form-data; name=\"file\"; filename=\"attachment\"\r\n".data(using: .utf8)!)
            multipart.append("Content-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
            multipart.append(attachment)
            multipart.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
            request.httpBody = multipart
        }

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw OutboxError.noResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw OutboxError.httpError(httpResponse.statusCode)
        }
    }
}

public enum DrainResult: Equatable {
    case noWork
    case partial(sent: Int, failed: Int)
}

public enum OutboxError: Error, LocalizedError {
    case invalidURL(String)
    case noResponse
    case httpError(Int)

    public var errorDescription: String? {
        switch self {
        case .invalidURL(let path): return "Invalid URL: \(path)"
        case .noResponse: return "No response from server"
        case .httpError(let code): return "HTTP \(code)"
        }
    }
}
