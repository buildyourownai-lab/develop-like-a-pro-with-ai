import SwiftUI

struct AiBriefingSection: View {
    let code: String
    @State private var state: UiState<BriefingResponse>?
    @Environment(\.appColors) private var colors
    private let repository = StockRepository()
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("AI 브리핑").font(.headline)
            Text("공개 시세와 OpenDART 공시를 근거로 생성합니다. 투자 조언이 아닙니다.").font(.footnote).foregroundColor(colors.onSurfaceVariant)
            switch state {
            case nil:
                Button("AI 브리핑 만들기") { generate() }.buttonStyle(.borderedProminent)
            case .loading: LoadingIndicator(label: "브리핑 만드는 중...")
            case .failure(let message): Text(message)
            case .success(let response): BriefingResultView(response: response)
            }
        }
    }
    private func generate() {
        state = .loading
        Task { do { state = .success(try await repository.postBriefing(code: code)) } catch { state = .failure(error.toUserMessage()) } }
    }
}

private struct BriefingResultView: View {
    let response: BriefingResponse
    @Environment(\.appColors) private var colors
    @Environment(\.openURL) private var openURL
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(response.briefing.headline).font(.title3.weight(.bold))
            BriefingGroup(title: "핵심", items: response.briefing.highlights)
            BriefingGroup(title: "시장 맥락", items: response.briefing.marketContext)
            BriefingGroup(title: "가격 맥락", items: response.briefing.priceContext)
            BriefingGroup(title: "공시 맥락", items: response.briefing.filingContext)
            BriefingGroup(title: "현재 근거로 알 수 없는 것", items: response.briefing.unknowns)
            if !response.packet.limits.isEmpty { Text("한계").fontWeight(.semibold); ForEach(response.packet.limits, id: \.self) { Text("· \($0)") } }
            if !response.packet.references.isEmpty {
                Text("근거 자료").fontWeight(.semibold)
                ForEach(response.packet.references) { reference in
                    Button { openURL(reference.url) } label: { Text("\(reference.label) · \(reference.provider)").underline() }.buttonStyle(.plain)
                }
            }
            Text("모델: \(response.model) · 작성 시각: \(response.generatedAt)").font(.footnote).foregroundColor(colors.onSurfaceVariant)
        }.padding(.top, 8)
    }
}

private struct BriefingGroup: View {
    let title: String; let items: [BriefingItem]
    var body: some View {
        if !items.isEmpty { Text(title).fontWeight(.semibold); ForEach(items) { item in Text("· \(item.text)") } }
    }
}
