import Testing
@testable import FeatureRunPlate

@Test func plateResultDecoding() throws {
    let json = """
    {"plate":"ABC123","state":"UT","isStolen":false,"registeredOwner":"John Doe",
     "make":"Toyota","model":"Camry","year":"2020","color":"Blue",
     "vin":"1HGBH41JXMN109186","registrationExpiration":"2026-12-31"}
    """.data(using: .utf8)!
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    let result = try decoder.decode(PlateResult.self, from: json)
    #expect(result.plate == "ABC123")
    #expect(result.state == "UT")
    #expect(result.isStolen == false)
    #expect(result.registeredOwner == "John Doe")
    #expect(result.make == "Toyota")
}

@Test func plateResultStolenFlag() throws {
    let json = """
    {"plate":"WNTED1","state":"UT","isStolen":true,"registeredOwner":null,
     "make":null,"model":null,"year":null,"color":null,"vin":null,"registrationExpiration":null}
    """.data(using: .utf8)!
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    let result = try decoder.decode(PlateResult.self, from: json)
    #expect(result.isStolen == true)
    #expect(result.registeredOwner == nil)
}
