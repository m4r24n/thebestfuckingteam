import SwiftUI

@main
struct TBFTMacApp: App {
    @StateObject private var model = TodayViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .onOpenURL { url in
                    guard url.scheme == "tbftmac" else { return }
                    model.showingWeb = false
                    Task { await model.refresh() }
                }
        }
        .defaultSize(width: 520, height: 680)
        .windowResizability(.contentMinSize)
    }
}
