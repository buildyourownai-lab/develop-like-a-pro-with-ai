import XCTest

// 실제 사용 흐름을 시뮬레이터에서 손으로 누르는 것과 같은 방식으로
// 검증한다. 이 환경에는 공공데이터포털·OpenDART 인증키가 없어 실제 서버는
// 항상 {"error":...}만 돌려주므로, 시장 화면 다음 단계(종목 상세·차트·AI
// 브리핑·전체 공시)는 실제 데이터로는 도달할 수 없다 — 그래서 앱 실행 인자
// "-UITestFixtures"로 계약과 같은 모양의 표본 데이터를 켜서, 화면 이동
// 로직 자체가 코드대로 동작하는지 확인한다(표본 데이터는 진짜 서비스
// 자료가 아니다).
final class AiStockBriefingUITests: XCTestCase {
    private func launchApp(withFixtures: Bool) -> XCUIApplication {
        let app = XCUIApplication()
        if withFixtures {
            // 앱 쪽 Network/UITestFixtures.swift의 UITestSupport.launchArgument와
            // 같은 문자열이다(UI 테스트 타깃은 앱 모듈을 import하지 않고 블랙박스로
            // 조작하므로 문자열을 그대로 맞춰 쓴다).
            app.launchArguments += ["-UITestFixtures"]
        }
        app.launch()
        return app
    }

    private func attachScreenshot(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    // 1) 시장 화면이 크래시 없이 뜨는지 — 인증키가 없어 데이터 대신 사람이
    // 읽을 에러 문구가 보이는 것이 이 환경에서는 정상이다.
    func testMarketScreenLoadsWithoutFixtures() {
        let app = launchApp(withFixtures: false)
        let title = app.staticTexts["국내 주식 한눈에"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        attachScreenshot(app, name: "01-market-no-fixtures")
    }

    // 2) 검색 입력 → 검색 아이콘 탭 → 검색 결과 화면으로 실제 이동하는지
    // (서버에 키가 없어 이 화면도 에러 문구를 보여주는 것이 정상이다).
    func testSearchNavigatesToSearchScreenWithoutFixtures() {
        let app = launchApp(withFixtures: false)
        let field = app.textFields["marketSearchField"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("삼성전자")
        app.buttons["marketSearchButton"].tap()

        let resultTitle = app.staticTexts["\"삼성전자\" 검색 결과"]
        XCTAssertTrue(resultTitle.waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["resultsSearchField"].exists)
        XCTAssertTrue(app.buttons["resultsSearchButton"].exists)
        attachScreenshot(app, name: "02-search-result-no-fixtures")
    }

    // 3) 표본 데이터로 전체 흐름을 눌러서 확인한다: 시장 화면 → 검색(결과
    // 1건 → 상세로 곧바로 이동, 검색 화면은 뒤로가기 스택에서 빠짐) → 차트
    // 구간 칩 탭 → AI 브리핑 만들기 버튼 탭(로딩 → 결과) → 전체 공시 화면
    // 진입까지, 실제로 화면을 이동시켜 크래시·빈 화면·레이아웃 문제가
    // 없는지 확인한다.
    func testFullFlowWithFixtures() {
        let app = launchApp(withFixtures: true)

        // 1) 시장 화면 — 표본 데이터(코스피/코스닥, 상승률 상위 종목)가 보여야 한다.
        let marketTitle = app.staticTexts["국내 주식 한눈에"]
        XCTAssertTrue(marketTitle.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["market-index-코스피"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["코스피 · 코스닥 현황"].exists)
        attachScreenshot(app, name: "10-market-with-fixtures")

        // 2) 검색 → 결과 1건 → 상세로 자동 이동(검색 화면은 스택에서 빠짐).
        let field = app.textFields["marketSearchField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("삼성전자")
        app.buttons["marketSearchButton"].tap()

        let stockTitle = app.staticTexts["삼성전자"]
        XCTAssertTrue(stockTitle.waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["detailSearchField"].exists)
        XCTAssertTrue(app.buttons["detailSearchButton"].exists)
        XCTAssertFalse(app.staticTexts["공시를 확인했습니다."].exists)
        attachScreenshot(app, name: "11-stock-detail-after-search")

        // 검색 화면이 뒤로가기 스택에 남아 있지 않아야 한다 — 뒤로 가면
        // 시장 화면(검색 화면이 아니라)이 나와야 한다.
        let backButton = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(backButton.waitForExistence(timeout: 5))
        backButton.tap()
        XCTAssertTrue(app.staticTexts["국내 주식 한눈에"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["\"삼성전자\" 검색 결과"].exists)

        // 다시 상세로 들어간다(이번엔 상승률 상위 카드를 직접 탭).
        let rankedCard = app.staticTexts["삼성전자"].firstMatch
        XCTAssertTrue(rankedCard.waitForExistence(timeout: 5))
        rankedCard.tap()
        XCTAssertTrue(app.staticTexts["종목코드: 005930 · KOSPI"].waitForExistence(timeout: 10))

        // 3) 차트 구간 칩 탭 — 크래시 없이 그대로 화면에 남아 있어야 한다.
        for label in ["1개월", "3개월", "1년"] {
            let chip = app.buttons["chartRange-\(label)"]
            XCTAssertTrue(chip.waitForExistence(timeout: 5))
            chip.tap()
        }
        attachScreenshot(app, name: "12-stock-chart-ranges")

        // 4) AI 브리핑 만들기 버튼 탭 → 로딩 → 구조화된 근거 기반 결과.
        let scrollView = app.scrollViews.firstMatch
        let briefingButton = app.buttons["AI 브리핑 만들기"]
        while !briefingButton.isHittable && scrollView.exists {
            scrollView.swipeUp()
            if briefingButton.waitForExistence(timeout: 1) && briefingButton.isHittable { break }
        }
        XCTAssertTrue(briefingButton.waitForExistence(timeout: 5))
        briefingButton.tap()

        XCTAssertTrue(app.staticTexts["공개 근거 기반 브리핑"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["현재 근거로 알 수 없는 것"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "13-ai-briefing-result")

        // 5) 전체 공시 화면 진입.
        let viewAllButton = app.buttons["viewAllDisclosuresButton"]
        while !viewAllButton.isHittable && scrollView.exists {
            scrollView.swipeUp()
            if viewAllButton.waitForExistence(timeout: 1) && viewAllButton.isHittable { break }
        }
        XCTAssertTrue(viewAllButton.waitForExistence(timeout: 5))
        viewAllButton.tap()

        XCTAssertTrue(app.staticTexts["최근 1년 전체 공시"].waitForExistence(timeout: 10))
        attachScreenshot(app, name: "14-all-disclosures")
    }
}
