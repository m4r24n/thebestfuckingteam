import Foundation

enum TBFTSharedStore {
    private static let cacheKey = "tbft.widget.state.v1"
    private static let refreshTokenKey = "tbft.widget.refresh-token.v1"

    private static var appGroupID: String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "TBFT_SHARED_GROUP_ID") as? String else {
            return nil
        }
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty ? nil : clean
    }

    private static var defaults: UserDefaults {
        guard let appGroupID else { return .standard }
        return UserDefaults(suiteName: appGroupID) ?? .standard
    }

    static func saveRefreshToken(_ token: String) {
        let clean = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        defaults.set(clean, forKey: refreshTokenKey)
    }

    static func refreshToken() -> String? {
        guard let token = defaults.string(forKey: refreshTokenKey)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !token.isEmpty else {
            return nil
        }
        return token
    }

    static var isConnected: Bool {
        refreshToken() != nil
    }

    static func clearSession() {
        defaults.removeObject(forKey: refreshTokenKey)
        saveState(.disconnected)
    }

    static func state() -> TBFTWidgetState {
        guard let data = defaults.data(forKey: cacheKey),
              let decoded = try? JSONDecoder().decode(TBFTWidgetState.self, from: data) else {
            return isConnected
                ? TBFTWidgetState(boardDate: nil, tasks: [], updatedAt: nil, error: nil)
                : .disconnected
        }
        return decoded
    }

    static func saveState(_ state: TBFTWidgetState) {
        guard let data = try? JSONEncoder().encode(state) else { return }
        defaults.set(data, forKey: cacheKey)
    }

    @discardableResult
    static func save(payload: TBFTWidgetPayload) -> TBFTWidgetState {
        let state = TBFTWidgetState(
            boardDate: payload.boardDate,
            tasks: payload.tasks,
            updatedAt: Date(),
            error: nil
        )
        saveState(state)
        return state
    }

    @discardableResult
    static func save(error: String) -> TBFTWidgetState {
        var current = state()
        current.error = error
        saveState(current)
        return current
    }
}
