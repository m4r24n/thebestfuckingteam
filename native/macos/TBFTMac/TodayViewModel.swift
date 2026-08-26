import Foundation
import WidgetKit

@MainActor
final class TodayViewModel: ObservableObject {
    @Published var state: TBFTWidgetState = TBFTSharedStore.state()
    @Published var isSyncing = false
    @Published var showingWeb = false

    var isConnected: Bool {
        TBFTSharedStore.isConnected
    }

    func refresh() async {
        guard !isSyncing else { return }
        guard isConnected else {
            state = .disconnected
            return
        }

        isSyncing = true
        defer { isSyncing = false }

        do {
            state = try await TBFTWidgetAPI.sync()
            WidgetCenter.shared.reloadAllTimelines()
        } catch {
            state = TBFTSharedStore.save(error: error.localizedDescription)
        }
    }

    func captured(refreshToken: String) {
        TBFTSharedStore.saveRefreshToken(refreshToken)
        state.error = nil
        TBFTSharedStore.saveState(state)
        Task { await refresh() }
    }

    func disconnect() {
        TBFTSharedStore.clearSession()
        state = .disconnected
        WidgetCenter.shared.reloadAllTimelines()
    }
}
