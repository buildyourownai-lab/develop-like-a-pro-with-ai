import XCTest
@testable import AiStockBriefing

final class AiBriefingSectionTests: XCTestCase {
    func testGroundedBriefingDecodesAllGroupsAndEvidence() throws {
        let json = #"{"packet":{"references":[{"id":"p","label":"시세","provider":"data.go.kr","url":"https://data.go.kr","baseDate":"20260904"}],"limits":["미래 예측 불가"]},"briefing":{"headline":"근거 기반","highlights":[{"text":"핵심","evidenceIds":["p"]}],"marketContext":[],"priceContext":[],"filingContext":[],"unknowns":[{"text":"알 수 없음","evidenceIds":[]}]},"model":"gemini","generatedAt":"2026-09-06T00:00:00Z"}"#
        let response = try JSONDecoder().decode(BriefingResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.briefing.headline, "근거 기반")
        XCTAssertEqual(response.briefing.highlights.first?.evidenceIds, ["p"])
        XCTAssertEqual(response.packet.limits, ["미래 예측 불가"])
    }
}
