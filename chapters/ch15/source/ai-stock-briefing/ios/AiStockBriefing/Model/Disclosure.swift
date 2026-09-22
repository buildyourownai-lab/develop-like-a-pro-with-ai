import Foundation

struct FilingSummary: Codable {
    let state: String; let corpName: String?; let from: String?; let to: String?
    let totalCount: Int; let recent: [Filing]
}
struct Filing: Codable, Identifiable {
    var id: String { receiptNo }
    let receiptNo: String; let receiptDate: String; let reportName: String; let filerName: String
    let noteLabels: [String]; let documentUrl: URL
}
struct FilingsResponse: Codable {
    let schemaVersion: String; let source: String; let code: String; let corpName: String
    let from: String; let to: String; let filings: [Filing]; let totalCount: Int; let pageNo: Int; let totalPage: Int
}
