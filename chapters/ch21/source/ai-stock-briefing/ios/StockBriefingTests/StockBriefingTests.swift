import XCTest
@testable import StockBriefing

final class StockBriefingTests: XCTestCase {
    func testKoreanDateFormatting() {
        XCTAssertEqual("20260820".koreanDate, "2026.08.20")
        XCTAssertEqual("unknown".koreanDate, "unknown")
    }
}
