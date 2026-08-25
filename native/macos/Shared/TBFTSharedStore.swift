import Foundation
import Security

enum TBFTSharedStore {
    static let appGroupID = "group.info.marzan.tbft"
    private static let cacheKey = "tbft.widget.state.v1"
    private static let keychainService = "info.marzan.tbft.widget-session"
    private static let keychainAccount = "refresh-token"

    private static var defaults: UserDefaults {
        UserDefaults(suiteName: appGroupID) ?? .standard
    }

    private static var accessGroup: String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "TBFT_KEYCHAIN_ACCESS_GROUP") as? String else {
            return nil
        }
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty ? nil : clean
    }

    private static func keychainQuery() -> [CFString: Any] {
        var query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: keychainService,
            kSecAttrAccount: keychainAccount,
        ]
        if let accessGroup {
            query[kSecAttrAccessGroup] = accessGroup
        }
        return query
    }

    static func saveRefreshToken(_ token: String) throws {
        let clean = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }

        var query = keychainQuery()
        let data = Data(clean.utf8)
        let attributes: [CFString: Any] = [
            kSecValueData: data,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlock,
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        if updateStatus != errSecItemNotFound {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(updateStatus))
        }

        query[kSecValueData] = data
        query[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlock
        let addStatus = SecItemAdd(query as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(addStatus))
        }
    }

    static func refreshToken() -> String? {
        var query = keychainQuery()
        query[kSecReturnData] = true
        query[kSecMatchLimit] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let token = String(data: data, encoding: .utf8),
              !token.isEmpty else {
            return nil
        }
        return token
    }

    static var isConnected: Bool {
        refreshToken() != nil
    }

    static func clearSession() {
        SecItemDelete(keychainQuery() as CFDictionary)
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
