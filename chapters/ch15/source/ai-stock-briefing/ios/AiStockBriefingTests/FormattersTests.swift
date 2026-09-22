import XCTest
@testable import AiStockBriefing

final class FormattersTests: XCTestCase {
    func testFormatPriceRoundsAndGroups() {
        XCTAssertEqual(formatPrice(1234.0), "1,234원")
        XCTAssertEqual(formatPrice(1234.6), "1,235원")
        XCTAssertEqual(formatPrice(0), "0원")
    }

    func testFormatChangeSignAndPrecision() {
        XCTAssertEqual(formatChange(150.5), "+150.5")
        XCTAssertEqual(formatChange(-150.5), "-150.5")
        XCTAssertEqual(formatChange(0), "0")
        XCTAssertEqual(formatChange(1234.567), "+1,234.567")
    }

    func testFormatChangeRateSignAndTwoDecimals() {
        XCTAssertEqual(formatChangeRate(1.2), "+1.20%")
        XCTAssertEqual(formatChangeRate(-1.2), "-1.20%")
        XCTAssertEqual(formatChangeRate(0), "0.00%")
    }

    func testFormatTradingValueDividesAndRounds() {
        XCTAssertEqual(formatTradingValue(250_000_000), "3억원")
        XCTAssertEqual(formatTradingValue(100_000_000), "1억원")
        XCTAssertEqual(formatTradingValue(123_456_000_000), "1,235억원")
        XCTAssertEqual(formatTradingValue(5_984_200_000_000), "5조 9,842억원")
    }

    func testFormatVolume() {
        XCTAssertEqual(formatVolume(1_234_567), "1,234,567주")
    }

    func testFormatIndexValueHasNoUnit() {
        XCTAssertEqual(formatIndexValue(2650.123), "2,650")
        XCTAssertEqual(formatIndexValue(100), "100")
    }

    func testFormatBaseDateLabel() {
        XCTAssertEqual(formatBaseDateLabel("20240115"), "2024.01.15")
        XCTAssertEqual(formatBaseDateLabel("abc"), "abc")
    }

    func testDirectionSymbolAndWord() {
        XCTAssertEqual(directionSymbol(1), "▲")
        XCTAssertEqual(directionSymbol(-1), "▼")
        XCTAssertEqual(directionSymbol(0), "－")

        XCTAssertEqual(directionWord(1), "상승")
        XCTAssertEqual(directionWord(-1), "하락")
        XCTAssertEqual(directionWord(0), "보합")
    }

    // 웹 format.ts의 formatDateTimeLabel과 같은 규칙: ISO(UTC) 시각을
    // Asia/Seoul(UTC+9)로 바꿔 "yyyy-MM-dd HH:mm"로 보여준다.
    func testFormatDateTimeLabelConvertsUtcToSeoul() {
        // 2024-01-15T15:30:00Z(UTC) -> 2024-01-16 00:30(KST, UTC+9)
        XCTAssertEqual(formatDateTimeLabel("2024-01-15T15:30:00Z"), "2024-01-16 00:30")
        // 자정을 넘지 않는 경우
        XCTAssertEqual(formatDateTimeLabel("2024-01-15T01:30:00Z"), "2024-01-15 10:30")
    }
}
