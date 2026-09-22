import SwiftUI

// OpenDART 제출인(flr_nm)은 회사명일 수도, 임원·주요주주 같은 개인 이름일
// 수도 있다. 웹 화면과 같은 형식으로 받은 값을 그대로 보여준다.
func submitterLabel(_ submitter: String, companyName: String) -> String {
    let trimmed = submitter.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
        return "제출인: \(companyName.trimmingCharacters(in: .whitespacesAndNewlines))"
    }
    return "제출인: \(trimmed)"
}

// 공시 한 건을 누르면 DART 원문이 열린다는 것을 화면에서 알 수 있게
// 보여주는 표시다 — 최근 공시·전체 공시·AI 브리핑 공시 목록에서 모두
// 같은 문구를 쓴다.
struct DartOriginalLinkLabel: View {
    @Environment(\.appColors) private var colors

    var body: some View {
        Text("DART 원문 열기")
            .font(.footnote)
            .foregroundColor(colors.accent)
            .underline()
    }
}
