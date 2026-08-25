import Foundation

enum TBFTWidgetAPIError: LocalizedError {
    case notConnected
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .notConnected:
            return "Open TBFT once to connect"
        case .invalidResponse:
            return "TBFT returned an invalid widget response."
        case .server(let message):
            return message
        }
    }
}

enum TBFTWidgetAPI {
    private static let endpoint = URL(string: "https://tbft.marzan.info/api/widget/tasks")!

    private struct RequestBody: Encodable {
        let refreshToken: String
    }

    private struct ErrorBody: Decodable {
        let error: String?
    }

    static func sync() async throws -> TBFTWidgetState {
        guard let refreshToken = TBFTSharedStore.refreshToken() else {
            throw TBFTWidgetAPIError.notConnected
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 12
        request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(RequestBody(refreshToken: refreshToken))

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw TBFTWidgetAPIError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data).error)
                ?? "Unable to refresh TBFT."
            throw TBFTWidgetAPIError.server(message)
        }

        let payload = try JSONDecoder().decode(TBFTWidgetPayload.self, from: data)
        if let rotatedToken = payload.refreshToken, !rotatedToken.isEmpty {
            try TBFTSharedStore.saveRefreshToken(rotatedToken)
        }
        return TBFTSharedStore.save(payload: payload)
    }
}
