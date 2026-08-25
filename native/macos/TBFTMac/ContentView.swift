import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: TodayViewModel

    var body: some View {
        ZStack {
            Color(red: 14 / 255, green: 14 / 255, blue: 14 / 255)
                .ignoresSafeArea()

            if model.showingWeb {
                fullAppView
            } else {
                todayView
            }
        }
        .frame(minWidth: 420, minHeight: 520)
        .task {
            await model.refresh()
        }
    }

    private var todayView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("TBFT")
                            .font(.system(size: 18, weight: .medium))
                            .tracking(1.4)
                            .foregroundStyle(.white)
                        Text(boardDateLabel)
                            .font(.system(size: 12))
                            .foregroundStyle(.white.opacity(0.65))
                    }

                    Spacer()

                    Button("Full app  →") {
                        model.showingWeb = true
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white.opacity(0.86))
                }

                Text(countLabel)
                    .font(.system(size: 28, weight: .regular))
                    .foregroundStyle(.white)
                    .padding(.top, 34)
                    .padding(.bottom, 18)

                if model.state.tasks.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(model.isConnected ? "Your board is clear." : "Open the full app once to connect your TBFT account.")
                            .font(.system(size: 15))
                            .foregroundStyle(.white.opacity(0.73))

                        if !model.isConnected {
                            Button("Connect TBFT  →") {
                                model.showingWeb = true
                            }
                            .buttonStyle(.plain)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.white.opacity(0.86))
                        }
                    }
                    .padding(.vertical, 8)
                } else {
                    VStack(spacing: 9) {
                        ForEach(model.state.tasks) { task in
                            HStack(spacing: 12) {
                                Text("○")
                                Text(task.displayTitle)
                                    .lineLimit(2)
                                Spacer(minLength: 0)
                            }
                            .font(.system(size: 16))
                            .foregroundStyle(.white.opacity(0.95))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 15)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.white.opacity(0.11), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .contentShape(Rectangle())
                            .onTapGesture {
                                model.showingWeb = true
                            }
                        }
                    }
                }

                HStack(spacing: 10) {
                    Text(syncLabel)
                        .font(.system(size: 11))
                        .foregroundStyle(.white.opacity(0.42))

                    Spacer()

                    if model.isConnected {
                        Button(model.isSyncing ? "Syncing…" : "Refresh") {
                            Task { await model.refresh() }
                        }
                        .buttonStyle(.plain)
                        .disabled(model.isSyncing)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.white.opacity(0.62))
                    }
                }
                .padding(.top, 24)
            }
            .padding(22)
        }
    }

    private var fullAppView: some View {
        VStack(spacing: 0) {
            HStack {
                Button("←  Today") {
                    model.showingWeb = false
                    Task { await model.refresh() }
                }
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white.opacity(0.86))

                Spacer()

                if model.isConnected {
                    Text("Widget connected")
                        .font(.system(size: 11))
                        .foregroundStyle(.white.opacity(0.46))
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 42)
            .background(Color(red: 14 / 255, green: 14 / 255, blue: 14 / 255))

            TBFTWebView { refreshToken in
                model.captured(refreshToken: refreshToken)
            }
        }
    }

    private var countLabel: String {
        let count = model.state.tasks.count
        if count == 0 { return "Nothing left today" }
        return "\(count) \(count == 1 ? "task" : "tasks") left"
    }

    private var boardDateLabel: String {
        guard let boardDate = model.state.boardDate,
              let date = Self.boardDateParser.date(from: boardDate) else {
            return Self.prettyDate.string(from: Date())
        }
        return Self.prettyDate.string(from: date)
    }

    private var syncLabel: String {
        if let error = model.state.error, !error.isEmpty {
            return error
        }
        if let updatedAt = model.state.updatedAt {
            return "Updated \(Self.timeFormatter.string(from: updatedAt)) · widget refreshes automatically"
        }
        return model.isConnected ? "Syncing…" : "Open the full app once to connect"
    }

    private static let boardDateParser: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let prettyDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE · MMM d"
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter
    }()
}
