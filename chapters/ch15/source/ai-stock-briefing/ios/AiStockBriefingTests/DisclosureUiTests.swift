import XCTest
@testable import AiStockBriefing

final class DisclosureUiTests: XCTestCase {
    func testSubmitterLabelUsesSubmitterWhenPresent() {
        XCTAssertEqual(submitterLabel("삼성전자", companyName: "삼성전자"), "제출인: 삼성전자")
        XCTAssertEqual(submitterLabel("홍길동", companyName: "삼성전자"), "제출인: 홍길동")
    }

    func testSubmitterLabelFallsBackToCompanyNameWhenBlank() {
        XCTAssertEqual(submitterLabel("", companyName: "삼성전자"), "제출인: 삼성전자")
        XCTAssertEqual(submitterLabel("   ", companyName: "삼성전자"), "제출인: 삼성전자")
    }
}
