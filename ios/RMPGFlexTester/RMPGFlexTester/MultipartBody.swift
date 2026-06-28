import Foundation

/// Build a multipart/form-data body. Empty string values are skipped (matches
/// the prior inline behaviour in FieldPhotoView). The file part is always last.
func buildMultipartBody(boundary: String,
                        fields: [String: String],
                        fileField: String,
                        filename: String,
                        mime: String,
                        fileData: Data) -> Data {
    var body = Data()
    for (key, value) in fields where !value.isEmpty {
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(key)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
    }
    body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(fileField)\"; filename=\"\(filename)\"\r\nContent-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
    body.append(fileData)
    body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
    return body
}
