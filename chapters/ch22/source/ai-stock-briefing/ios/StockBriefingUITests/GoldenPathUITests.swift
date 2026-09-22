import XCTest

final class GoldenPathUITests: XCTestCase {
    @MainActor
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testMarketSearchDisclosureAndBriefing() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let server = ProcessInfo.processInfo.environment["CHAPTER15_BASE_URL"]
            ?? "https://ai-stock-briefing.vercel.app"
        app.launchEnvironment["API_BASE_URL_OVERRIDE"] = server
        app.launch()
        XCTAssertTrue(app.navigationBars["국내 주식 한눈에"].waitForExistence(timeout: 30))
        XCTAssertTrue(
            app.staticTexts
                .matching(NSPredicate(format: "label CONTAINS '주식시세 기준일'"))
                .firstMatch
                .waitForExistence(timeout: 30)
        )
        capture("screen-15-01-market")

        let search = app.textFields["stock-search-field"]
        search.tap()
        search.typeText("하이닉스")
        app.buttons["stock-search-button"].tap()

        XCTAssertTrue(app.descendants(matching: .any)["stock-detail-title"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'SK하이닉스'")).firstMatch.exists)
        capture("screen-15-02-stock-detail")

        let chartTitle = app.descendants(matching: .any)["price-chart-title"]
        XCTAssertTrue(chartTitle.exists)
        while !chartTitle.isHittable { app.swipeUp() }
        app.swipeUp()
        capture("screen-15-03-candlestick-chart")

        XCTAssertTrue(app.descendants(matching: .any)["filings-title"].exists)
        let dartLink = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH 'dart-link-'"))
            .firstMatch
        XCTAssertTrue(dartLink.exists)
        while !dartLink.isHittable { app.swipeUp() }
        capture("screen-15-04-filings")
        dartLink.tap()
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 15))
        capture("screen-15-05-dart-safari")
        app.activate()
        XCTAssertTrue(app.descendants(matching: .any)["stock-detail-title"].waitForExistence(timeout: 10))

        let briefingButton = app.buttons["briefing-button"]
        app.swipeUp()
        app.swipeUp()
        XCTAssertTrue(briefingButton.waitForExistence(timeout: 10))
        briefingButton.tap()
        let briefingTitle = app.descendants(matching: .any)["briefing-title"]
        XCTAssertTrue(briefingTitle.waitForExistence(timeout: 60))
        while !briefingTitle.isHittable { app.swipeUp() }
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS '근거 출처 3개'")).firstMatch.exists)
        app.swipeUp()
        capture("screen-15-06-ai-briefing")
    }
}
