import SwiftUI

// 자료를 가져오는 중인 상태를 오류·빈 결과와 구분해 보여준다 — 모든 화면이
// 같은 모양으로 보여주도록 여기 하나만 둔다.
struct LoadingIndicator: View {
    var label: String = "불러오는 중입니다…"

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ProgressView()
            Text(label)
                .font(.footnote)
        }
    }
}
