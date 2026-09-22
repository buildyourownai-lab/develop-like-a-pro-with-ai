import SwiftUI

enum AppHeaderStatus {
    case loading
    case success
    case failure(String)
}

// 시장에서 시작한 검색 도구와 현재 상태를 검색 결과·상세 화면에서도 그대로
// 유지한다. 각 화면이 같은 헤더를 사용하므로 상세 내용을 보다가도 곧바로
// 다른 종목을 찾을 수 있고, 검색을 제출할 때 입력 포커스도 함께 해제된다.
struct AppHeader: View {
    @Binding var query: String
    let status: AppHeaderStatus
    let accessibilityPrefix: String
    let onSearch: (String) -> Void
    @Environment(\.appColors) private var colors
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("국내 주식 한눈에")
                .font(.largeTitle.weight(.bold))
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("\(accessibilityPrefix)HeaderTitle")

            HStack(spacing: 10) {
                TextField("종목명 또는 종목코드", text: $query)
                    .padding(.horizontal, 14)
                    .frame(height: 48)
                    .background(colors.background, in: RoundedRectangle(cornerRadius: 13))
                    .overlay {
                        RoundedRectangle(cornerRadius: 13)
                            .stroke(colors.outlineVariant, lineWidth: 1)
                    }
                    .focused($searchFocused)
                    .submitLabel(.search)
                    .onSubmit(performSearch)
                    .accessibilityLabel("종목명 또는 종목코드")
                    .accessibilityIdentifier("\(accessibilityPrefix)SearchField")

                Button(action: performSearch) {
                    Text("검색").foregroundColor(.white)
                }
                    .buttonStyle(.borderedProminent)
                    .tint(colors.accent)
                    .controlSize(.large)
                    .accessibilityLabel("종목 검색")
                    .accessibilityIdentifier("\(accessibilityPrefix)SearchButton")
            }

            switch status {
            case .loading:
                HStack(spacing: 8) {
                    ProgressView()
                    Text("데이터를 불러오는 중입니다.")
                }
                .foregroundColor(colors.onSurfaceVariant)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("데이터를 불러오는 중입니다.")
            case .success:
                EmptyView()
            case .failure(let message):
                Text(message)
                    .foregroundColor(.noticeColor)
                    .accessibilityLabel("오류: \(message)")
            }
        }
    }

    private func performSearch() {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        searchFocused = false
        onSearch(trimmed)
    }
}

// 웹의 카드형 테두리(indexCard·detailGrid div 등, 흰 배경 + 1px 테두리 +
// 둥근 모서리)와 같은 인상을 주는 공통 카드. 시장·검색·공시 화면이 모두
// 이 카드 하나를 함께 써서, 목록이 글자만 줄줄이 나오지 않게 한다.
struct ListCard<Content: View>: View {
    var onTap: (() -> Void)?
    @ViewBuilder var content: Content
    @Environment(\.appColors) private var colors

    var body: some View {
        let card = VStack(alignment: .leading, spacing: 4) {
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(colors.background)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(colors.outlineVariant, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: colors.foreground.opacity(0.06), radius: 8, y: 3)

        if let onTap {
            Button(action: onTap) { card }
                .buttonStyle(.plain)
        } else {
            card
        }
    }
}

// 웹의 <h2> 섹션 제목과 같은 자리에, 같은 문구로 쓰는 공통 제목.
struct SectionHeading: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.title3.weight(.semibold))
    }
}

// 누르면 다른 화면으로 이동한다는 것을 색만이 아니라 모양(">")으로도 알려
// 주는 공통 표시 — 카드 오른쪽 끝에 둔다.
struct NavigationChevron: View {
    @Environment(\.appColors) private var colors

    var body: some View {
        Text(">")
            .font(.title3.weight(.semibold))
            .foregroundColor(colors.accent)
    }
}

// 상승/하락을 색만으로 전달하지 않기 위한 공통 표시. 눈으로는 기호(▲/▼)와
// 부호(+/-)가 같이 보이고, VoiceOver에는 "상승"/"하락"/"보합" 낱말이 함께
// 읽힌다(웹 ChangeIndicator.tsx와 같은 접근).
struct ChangeIndicator: View {
    let value: Double
    let visibleText: String
    @Environment(\.appColors) private var colors

    var body: some View {
        HStack(spacing: 2) {
            Text(directionSymbol(value))
                .accessibilityHidden(true)
            Text(visibleText)
        }
        .foregroundColor(colors.direction(value))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(directionWord(value)) \(visibleText)")
    }
}
