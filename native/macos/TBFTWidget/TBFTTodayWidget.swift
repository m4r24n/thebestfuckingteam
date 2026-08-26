import SwiftUI
import WidgetKit

struct TBFTTodayEntry: TimelineEntry {
    let date: Date
    let state: TBFTWidgetState
}

struct TBFTTodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TBFTTodayEntry {
        TBFTTodayEntry(
            date: Date(),
            state: TBFTWidgetState(
                boardDate: nil,
                tasks: [
                    TBFTWidgetTask(id: "1", title: "Finish the important thing", priority: "high", deadline: "10:30", carried: false, originalDate: ""),
                    TBFTWidgetTask(id: "2", title: "Reply to the message", priority: "normal", deadline: nil, carried: true, originalDate: ""),
                    TBFTWidgetTask(id: "3", title: "Pick up groceries", priority: "normal", deadline: nil, carried: false, originalDate: ""),
                ],
                updatedAt: Date(),
                error: nil
            )
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (TBFTTodayEntry) -> Void) {
        if context.isPreview {
            completion(placeholder(in: context))
            return
        }
        completion(TBFTTodayEntry(date: Date(), state: TBFTSharedStore.state()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TBFTTodayEntry>) -> Void) {
        Task {
            let state: TBFTWidgetState
            do {
                state = try await TBFTWidgetAPI.sync()
            } catch {
                state = TBFTSharedStore.save(error: error.localizedDescription)
            }

            let entry = TBFTTodayEntry(date: Date(), state: state)
            let refreshDate = Date().addingTimeInterval(30 * 60)
            completion(Timeline(entries: [entry], policy: .after(refreshDate)))
        }
    }
}

struct TBFTTodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TBFTTodayEntry

    private var taskLimit: Int {
        switch family {
        case .systemSmall: 3
        case .systemMedium: 5
        case .systemLarge: 9
        default: 5
        }
    }

    private var visibleTasks: ArraySlice<TBFTWidgetTask> {
        entry.state.tasks.prefix(taskLimit)
    }

    private var hiddenTaskCount: Int {
        max(0, entry.state.tasks.count - visibleTasks.count)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header

            if entry.state.tasks.isEmpty {
                Spacer(minLength: 8)
                Text(emptyLabel)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.72))
                    .lineLimit(3)
                Spacer(minLength: 8)
            } else {
                taskList
                Spacer(minLength: 4)
            }

            footer
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .widgetAccentable(false)
        .widgetURL(URL(string: "tbftmac://today"))
        .containerBackground(for: .widget) {
            Color(red: 0.075, green: 0.078, blue: 0.082)
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text("TBFT")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .tracking(0.8)
                    .foregroundStyle(.white.opacity(0.98))

                Text("TODAY")
                    .font(.system(size: 9, weight: .semibold, design: .rounded))
                    .tracking(1.1)
                    .foregroundStyle(.white.opacity(0.45))
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 0) {
                Text("\(entry.state.tasks.count)")
                    .font(.system(size: 25, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white.opacity(0.98))
                    .contentTransition(.numericText())

                Text(entry.state.tasks.count == 1 ? "TASK LEFT" : "TASKS LEFT")
                    .font(.system(size: 8, weight: .semibold, design: .rounded))
                    .tracking(0.7)
                    .foregroundStyle(.white.opacity(0.45))
            }
        }
        .padding(.bottom, family == .systemSmall ? 9 : 8)
    }

    private var taskList: some View {
        VStack(alignment: .leading, spacing: family == .systemLarge ? 7 : 4) {
            ForEach(visibleTasks) { task in
                HStack(spacing: 8) {
                    Circle()
                        .stroke(.white.opacity(0.52), lineWidth: 1.25)
                        .frame(width: 9, height: 9)

                    if task.carried {
                        Text("↪")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(.white.opacity(0.46))
                    }

                    Text(task.title)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white.opacity(0.92))
                        .lineLimit(1)
                        .truncationMode(.tail)

                    Spacer(minLength: 6)

                    if let deadline = cleanDeadline(task.deadline) {
                        Text(deadline)
                            .font(.system(size: 10, weight: .medium, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(.white.opacity(0.48))
                    }
                }
                .frame(minHeight: family == .systemLarge ? 19 : 17)
            }
        }
    }

    private var footer: some View {
        HStack(spacing: 8) {
            if hiddenTaskCount > 0 {
                Text("+\(hiddenTaskCount) more")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.white.opacity(0.48))
            } else {
                Text(syncLabel)
                    .font(.system(size: 10, weight: .regular))
                    .foregroundStyle(.white.opacity(0.38))
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            if hiddenTaskCount > 0, let updatedAt = entry.state.updatedAt {
                Text("Updated \(Self.timeFormatter.string(from: updatedAt))")
                    .font(.system(size: 10, weight: .regular))
                    .foregroundStyle(.white.opacity(0.34))
                    .lineLimit(1)
            }
        }
        .padding(.top, 5)
    }

    private var emptyLabel: String {
        if let error = entry.state.error, !error.isEmpty {
            return error
        }
        return TBFTSharedStore.isConnected ? "You're clear for now" : "Open TBFT once to connect"
    }

    private var syncLabel: String {
        if let error = entry.state.error, !error.isEmpty, TBFTSharedStore.isConnected {
            return "Sync needs attention · open TBFT"
        }
        if let updatedAt = entry.state.updatedAt {
            return "Updated \(Self.timeFormatter.string(from: updatedAt))"
        }
        return "Updates automatically"
    }

    private func cleanDeadline(_ value: String?) -> String? {
        guard let value else { return nil }
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty ? nil : clean
    }

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter
    }()
}

struct TBFTTodayWidget: Widget {
    let kind = "TBFTTodayWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TBFTTodayProvider()) { entry in
            TBFTTodayWidgetView(entry: entry)
        }
        .configurationDisplayName("TBFT Today")
        .description("Your remaining TBFT tasks for today.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
        .containerBackgroundRemovable(false)
    }
}
