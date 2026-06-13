import XCTest
@testable import RMPGFlexTester

final class FieldCalcTests: XCTestCase {

    func testPhonetic() {
        XCTAssertEqual(FieldCalc.phonetic("ABC123"), "Adam Boy Charles One Two Three")
        XCTAssertEqual(FieldCalc.phonetic("abc", alphabet: FieldCalc.nato), "Alfa Bravo Charlie")
        XCTAssertEqual(FieldCalc.phonetic("A 9"), "Adam · Niner")
        XCTAssertEqual(FieldCalc.phonetic("!?"), "")
    }

    func testSkidSpeed() {
        // S = √(30·d·f): 60 ft on dry asphalt (.75) → √1350 ≈ 36.7 mph
        XCTAssertEqual(FieldCalc.skidSpeedMph(distanceFeet: 60, dragFactor: 0.75), 36.74, accuracy: 0.01)
        XCTAssertEqual(FieldCalc.skidSpeedMph(distanceFeet: 0, dragFactor: 0.75), 0)
        XCTAssertEqual(FieldCalc.skidSpeedMph(distanceFeet: 100, dragFactor: 0), 0)
    }

    func testHaversineAndBearing() {
        // SLC Temple Square → Utah State Capitol ≈ 1.0 km, roughly north.
        let d = FieldCalc.distanceMeters(lat1: 40.7707, lon1: -111.8911, lat2: 40.7774, lon2: -111.8882)
        XCTAssertEqual(d, 785, accuracy: 60)
        let b = FieldCalc.bearingDegrees(lat1: 40.7707, lon1: -111.8911, lat2: 40.7774, lon2: -111.8882)
        XCTAssertTrue(b > 0 && b < 45, "expected NNE-ish bearing, got \(b)")
        XCTAssertEqual(FieldCalc.compassPoint(0), "N")
        XCTAssertEqual(FieldCalc.compassPoint(180), "S")
        XCTAssertEqual(FieldCalc.compassPoint(359), "N")
    }

    func testParseLatLon() {
        XCTAssertNotNil(FieldCalc.parseLatLon("40.7608, -111.8910"))
        XCTAssertNotNil(FieldCalc.parseLatLon("(40.7608 -111.8910)"))
        XCTAssertNil(FieldCalc.parseLatLon("99, -200"))
        XCTAssertNil(FieldCalc.parseLatLon("not coords"))
    }

    func testSunTimesSaltLakeJune() {
        // SLC (40.76, -111.89), June 12 (doy 163). MDT = UTC-6:
        // sunrise ≈ 05:57 local (11:57 UTC = 717), sunset ≈ 21:00 (03:00 UTC = 180).
        let rise = FieldCalc.sunTimeUTCMinutes(dayOfYear: 163, lat: 40.76, lon: -111.89, sunrise: true)
        let set = FieldCalc.sunTimeUTCMinutes(dayOfYear: 163, lat: 40.76, lon: -111.89, sunrise: false)
        XCTAssertNotNil(rise); XCTAssertNotNil(set)
        XCTAssertEqual(rise!, 717, accuracy: 12)
        XCTAssertEqual(set!, 180, accuracy: 12)
        // Civil twilight extends the day on both ends.
        let dawn = FieldCalc.sunTimeUTCMinutes(dayOfYear: 163, lat: 40.76, lon: -111.89, sunrise: true, zenith: 96)!
        XCTAssertLessThan(dawn, rise!)
        // Polar night: Utqiaġvik in December has no sunrise.
        XCTAssertNil(FieldCalc.sunTimeUTCMinutes(dayOfYear: 355, lat: 71.29, lon: -156.79, sunrise: true))
    }

    func testConversions() {
        XCTAssertEqual(FieldCalc.cmToFeetInches(180), "5'11\"")
        XCTAssertEqual(FieldCalc.cmToFeetInches(183), "6'0\"")
        XCTAssertEqual(FieldCalc.kgToLbs(75), 165)
        XCTAssertEqual(FieldCalc.kmhToMph(100), 62)
        XCTAssertEqual(FieldCalc.convert("180cm"), "180 cm = 5'11\"")
        XCTAssertEqual(FieldCalc.convert("75kg"), "75 kg = 165 lbs")
        XCTAssertEqual(FieldCalc.convert("100kmh"), "100 km/h = 62 mph")
        XCTAssertEqual(FieldCalc.convert("5'11"), "5'11\" = 180 cm")
        XCTAssertNil(FieldCalc.convert("gibberish"))
    }
}
