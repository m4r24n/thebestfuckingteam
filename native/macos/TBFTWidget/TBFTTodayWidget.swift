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
        default: 6
        }
    }

    private var visibleTasks: ArraySlice<TBFTWidgetTask> {
        entry.state.tasks.prefix(taskLimit)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("TBFT · TODAY")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white.opacity(0.95))

            Text(countLabel)
                .font(.system(size: 11))
                .foregroundStyle(.white.opacity(0.65))
                .padding(.top, 2)
                .padding(.bottom, 8)

            if entry.state.tasks.isEmpty {
                Spacer(minLength: 4)
                Text(emptyLabel)
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.75))
                    .lineLimit(3)
                Spacer(minLength: 4)
            } else {
                ForEach(visibleTasks) { task in
                    HStack(spacing: 8) {
                        Text("○")
                        Text(task.displayTitle)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        Spacer(minLength: 0)
                    }
                    .font(.system(size: 14))
                    .foregroundStyle(.white.opacity(0.95))
                    .padding(.vertical, 3)
                }
                Spacer(minLength: 0)
            }

            Text(syncLabel)
                .font(.system(size: 10))
                .foregroundStyle(.white.opacity(0.50))
                .padding(.top, 6)
                .lineLimit(1)
        }
        .padding(14)
        .widgetURL(URL(string: "tbftmac://today"))
        .containerBackground(for: .widget) {
            Color.black.opacity(0.15)
        }
    }

    private var countLabel: String {
        let count = entry.state.tasks.count
        if count == 0 { return "No remaining tasks" }
        return "\(count) \(count == 1 ? "task remaining" : "tasks remaining")"
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
            return "Updated \(Self.timeFormatter.string(from: updatedAt)) · auto refresh"
        }
        return "Updates automatically"
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
    }
}
