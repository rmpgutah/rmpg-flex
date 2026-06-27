import Foundation
import SwiftData

@Model
public final class OutboxEntry {
    public var id: UUID
    public var endpoint: String
    public var method: String
    public var body: Data?
    public var headers: [String: String]
    public var attemptCount: Int
    public var lastError: String?
    public var createdAt: Date
    public var isFailed: Bool

    @Attribute(.externalStorage) public var attachmentData: Data?

    public init(
        id: UUID = UUID(),
        endpoint: String,
        method: String = "POST",
        body: Data? = nil,
        headers: [String: String] = [:],
        attachmentData: Data? = nil
    ) {
        self.id = id
        self.endpoint = endpoint
        self.method = method
        self.body = body
        self.headers = headers
        self.attemptCount = 0
        self.lastError = nil
        self.createdAt = Date()
        self.isFailed = false
        self.attachmentData = attachmentData
    }

    public var idempotencyKey: String { id.uuidString }
}
