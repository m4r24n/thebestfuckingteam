import Foundation

struct TBFTWidgetTask: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let priority: String
    let deadline: String?
    let carried: Bool
    let originalDate: String

    var displayTitle: String {
        let prefix = carried ? "↪ " : ""
        let suffix = deadline.flatMap { value in
            let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return clean.isEmpty ? nil : " · \(clean)"
        } ?? ""
        return "\(prefix)\(title)\(suffix)"
    }
}

struct TBFTWidgetPayload: Codable {
    let boardDate: String?
    let timezone: String?
    let count: Int
    let tasks: [TBFTWidgetTask]
    let refreshToken: String?
}

struct TBFTWidgetState: Codable, Equatable {
    var boardDate: String?
    var tasks: [TBFTWidgetTask]
    var updatedAt: Date?
    var error: String?

    static let disconnected = TBFTWidgetState(
        boardDate: nil,
        tasks: [],
        updatedAt: nil,
        error: "Open TBFT once to connect"
    )
}
