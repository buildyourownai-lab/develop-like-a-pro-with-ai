import XCTest
@testable import AiStockBriefing

final class ModelDecodingTests: XCTestCase {
    func testStockResponseUsesProductionFields() throws {
        let json = #"{"schemaVersion":"1","sources":["data.go.kr"],"marketBaseDate":"20260904","quote":{"baseDate":"20260904","code":"005930","name":"삼성전자","market":"KOSPI","close":71500,"diff":1500,"changeRate":2.14,"open":70000,"high":72000,"low":69000,"volume":10,"tradeValue":715000},"bars":[{"date":"20260904","open":70000,"high":72000,"low":69000,"close":71500,"volume":10,"tradeValue":715000}],"filings":{"state":"ready","corpName":"삼성전자","from":"20250904","to":"20260904","totalCount":0,"recent":[]}}"#
        let value = try JSONDecoder().decode(StockResponse.self, from: Data(json.utf8))
        XCTAssertEqual(value.quote.close, 71500)
        XCTAssertEqual(value.bars.first?.date, "20260904")
        XCTAssertEqual(value.filings.state, "ready")
    }

    func testFilingsPageDecodesTopLevelPagination() throws {
        let json = #"{"schemaVersion":"1","source":"OpenDART","code":"005930","corpName":"삼성전자","from":"20250904","to":"20260904","filings":[],"totalCount":21,"pageNo":2,"totalPage":2}"#
        let value = try JSONDecoder().decode(FilingsResponse.self, from: Data(json.utf8))
        XCTAssertEqual(value.pageNo, 2)
        XCTAssertEqual(value.totalCount, 21)
    }
}
