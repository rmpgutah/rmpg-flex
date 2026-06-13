import Foundation

enum MultipartUpload {
    /// POST a jpeg + string fields as multipart/form-data. Returns parsed JSON.
    @discardableResult
    static func upload(_ client: RMPGAPIClient, path: String,
                       fields: [String: String], jpeg: Data) async throws -> Any {
        let boundary = "rmpg-\(UUID().uuidString)"
        let body = buildMultipartBody(boundary: boundary, fields: fields,
                                      fileField: "photo", filename: "field.jpg",
                                      mime: "image/jpeg", fileData: jpeg)
        var req = URLRequest(url: URL(string: client.baseURL.absoluteString + "/" + path)!)
        req.httpMethod = "POST"
        if let jwt = client.jwt { req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization") }
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw NSError(domain: "RMPG", code: status,
                          userInfo: [NSLocalizedDescriptionKey: "HTTP \(status): \(String(data: data, encoding: .utf8)?.prefix(150) ?? "")"])
        }
        return (try? JSONSerialization.jsonObject(with: data)) ?? [:]
    }
}
