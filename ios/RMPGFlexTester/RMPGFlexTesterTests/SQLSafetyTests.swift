import XCTest
@testable import RMPGFlexTester

final class SQLSafetyTests: XCTestCase {
    func testSelectIsReadOnly() {
        XCTAssertFalse(SQLSafety.isDestructive("SELECT * FROM calls_for_service LIMIT 5"))
        XCTAssertFalse(SQLSafety.isDestructive("  select 1"))
        XCTAssertFalse(SQLSafety.isDestructive("PRAGMA table_info('units')"))
        XCTAssertFalse(SQLSafety.isDestructive("EXPLAIN QUERY PLAN SELECT 1"))
    }

    func testWriteStatementsAreDestructive() {
        for sql in [
            "INSERT INTO t VALUES (1)",
            "update t set a=1",
            "DELETE FROM t",
            "DROP TABLE t",
            "ALTER TABLE t ADD COLUMN x",
            "CREATE TABLE t (id INTEGER)",
        ] {
            XCTAssertTrue(SQLSafety.isDestructive(sql), sql)
        }
    }

    func testCTEReadOnlyVsWrite() {
        XCTAssertFalse(SQLSafety.isDestructive("WITH x AS (SELECT 1) SELECT * FROM x"))
        XCTAssertTrue(SQLSafety.isDestructive("WITH x AS (SELECT 1) DELETE FROM t WHERE id IN (SELECT * FROM x)"))
    }

    func testMultiStatementAndComments() {
        XCTAssertTrue(SQLSafety.isDestructive("SELECT 1; DROP TABLE t"))
        XCTAssertFalse(SQLSafety.isDestructive("-- drop table t\nSELECT 1"))
        XCTAssertFalse(SQLSafety.isDestructive(""))
    }
}
