import Foundation
import UIKit


/// Network layer for the field-officer Process Serve workflow: list assigned
/// jobs, log a service attempt, and attach evidence (photo/signature) to it.
public struct ServeAPI: Sendable {
    let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// GET /api/serve — bare array, not `{results:[...]}` (verified against
    /// src/routes/serve.ts; the prior client assumed the wrong wrapper shape).
    public func listJobs(status: String? = nil, officerId: Int? = nil) async throws -> [ServeJob] {
        var query: [URLQueryItem] = []
        if let status { query.append(URLQueryItem(name: "status", value: status)) }
        if let officerId { query.append(URLQueryItem(name: "officer_id", value: String(officerId))) }
        return try await client.request(Endpoint(path: "/api/serve", queryItems: query))
    }

    public func getJob(id: Int) async throws -> ServeJob {
        try await client.request(Endpoint(path: "/api/serve/\(id)"))
    }

    /// POST /api/serve/:id/attempt — logs a service attempt. `photoIds` must
    /// already be uploaded via `uploadPhoto(...)` before calling this.
    public func logAttempt(jobId: Int, _ req: ServeAttemptRequest) async throws {
        let body = try JSONEncoder.serveDefault.encode(req)
        try await client.requestVoid(Endpoint(path: "/api/serve/\(jobId)/attempt", method: .post, body: body))
    }

    /// Uploads a proof-of-service photo, linked to this serve job via
    /// entity_type/entity_id, and returns the numeric attachment id to pass
    /// as one of `ServeAttemptRequest.photoIds`.
    public func uploadPhoto(jobId: Int, image: UIImage) async throws -> Int {
        guard let data = image.jpegData(compressionQuality: 0.8) else {
            throw APIError.unknown("Could not encode photo")
        }
        let results: [UploadedAttachment] = try await client.uploadMultipart(
            path: "/api/uploads",
            fileName: "serve-\(jobId)-\(UUID().uuidString).jpg",
            mimeType: "image/jpeg",
            fileData: data,
            formFields: ["entity_type": "serve_queue", "entity_id": String(jobId)]
        )
        guard let first = results.first else {
            throw APIError.unknown("Upload returned no attachment")
        }
        return first.id
    }
}

private extension JSONEncoder {
    static let serveDefault: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return encoder
    }()
}
