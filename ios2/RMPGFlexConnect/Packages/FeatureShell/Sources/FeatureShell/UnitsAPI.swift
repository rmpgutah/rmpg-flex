import CoreAPI

public struct UnitsAPI {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func fetchUnits() async throws -> [DispatchUnit] {
        let endpoint = Endpoint(method: .get, path: "api/dispatch/units")
        return try await client.request(endpoint, as: [DispatchUnit].self)
    }
}
