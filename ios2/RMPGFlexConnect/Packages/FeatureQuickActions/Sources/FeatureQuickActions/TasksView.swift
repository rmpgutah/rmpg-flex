import SwiftUI
import DesignSystem
import CoreAPI

@MainActor
struct TasksView: View {
    @Environment(\.theme) private var theme
    @State private var tasks: [OfficerTask] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var showCreate = false

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                if isLoading && tasks.isEmpty {
                    ProgressView().tint(theme.colors.brandGold)
                } else if let error, tasks.isEmpty {
                    errorView(error)
                } else if tasks.isEmpty {
                    emptyView
                } else {
                    taskList
                }
            }
            .navigationTitle("MY TASKS")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .toolbar {
                ToolbarItem(placement: RmpgToolbarPlacement.trailing.placement) {
                    Button { showCreate = true } label: {
                        Image(systemName: "plus.circle.fill")
                            .foregroundStyle(theme.colors.brandGold).font(.title3)
                    }
                    .accessibilityLabel("New Task")
                }
                ToolbarItem(placement: RmpgToolbarPlacement.leading.placement) {
                    Button { Task { await load() } } label: {
                        Image(systemName: "arrow.clockwise").foregroundStyle(theme.colors.brandGold)
                    }
                }
            }
            .task { await load() }
            .sheet(isPresented: $showCreate) {
                CreateTaskSheet(apiClient: apiClient) { Task { await load() } }
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
        }
    }

    private var taskList: some View {
        List {
            ForEach(TaskPriority.allCases, id: \.self) { priority in
                let group = tasks.filter { $0.priorityEnum == priority && $0.status != "completed" && $0.status != "cancelled" }
                if !group.isEmpty {
                    Section(header: priorityHeader(priority)) {
                        ForEach(group) { task in
                            taskRow(task)
                        }
                    }
                }
            }
            let done = tasks.filter { $0.status == "completed" || $0.status == "cancelled" }
            if !done.isEmpty {
                Section(header: Text("COMPLETED").font(.caption2).tracking(1).foregroundStyle(theme.colors.textMuted)) {
                    ForEach(done.prefix(5)) { task in
                        taskRow(task)
                    }
                }
            }
        }
        #if os(iOS)
        .listStyle(.insetGrouped)
        #endif
        .scrollContentBackground(.hidden)
        .background(theme.colors.surfaceBase)
    }

    private func priorityHeader(_ p: TaskPriority) -> some View {
        HStack(spacing: 6) {
            Circle().fill(p.color(theme)).frame(width: 7, height: 7)
            Text(p.label).font(.caption2.weight(.semibold)).tracking(1).foregroundStyle(theme.colors.textMuted)
        }
    }

    private func taskRow(_ task: OfficerTask) -> some View {
        HStack(spacing: 12) {
            Circle().fill(task.statusColor(theme)).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 3) {
                Text(task.task_title).font(.subheadline.weight(.semibold))
                    .foregroundStyle(task.status == "completed" ? theme.colors.textMuted : theme.colors.textPrimary)
                    .strikethrough(task.status == "completed")
                if let desc = task.description, !desc.isEmpty {
                    Text(desc).font(.caption2).foregroundStyle(theme.colors.textMuted).lineLimit(1)
                }
                HStack(spacing: 8) {
                    if let due = task.due_date {
                        Label(due, systemImage: "calendar").font(.caption2).foregroundStyle(
                            task.isOverdue ? theme.colors.critical : theme.colors.textMuted)
                    }
                    if let assignee = task.assigned_to_name {
                        Label(assignee, systemImage: "person.fill").font(.caption2)
                            .foregroundStyle(theme.colors.textMuted)
                    }
                }
            }
            Spacer()
            statusChip(task)
        }
        .listRowBackground(theme.colors.surfaceRaised)
    }

    private func statusChip(_ task: OfficerTask) -> some View {
        Text(task.status.uppercased().replacingOccurrences(of: "_", with: " "))
            .font(.caption2.weight(.semibold)).tracking(0.3)
            .foregroundStyle(task.statusColor(theme))
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(task.statusColor(theme).opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 3))
    }

    private var emptyView: some View {
        VStack(spacing: 12) {
            Image(systemName: "checklist").font(.system(size: 44)).foregroundStyle(theme.colors.textMuted)
            Text("No tasks assigned").font(.headline).foregroundStyle(theme.colors.textMuted)
            Button("Create Task") { showCreate = true }
                .font(.caption.weight(.semibold)).foregroundStyle(theme.colors.brandGold)
        }
    }

    private func errorView(_ msg: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle").font(.largeTitle).foregroundStyle(theme.colors.warning)
            Text(msg).font(.caption).foregroundStyle(theme.colors.textMuted).multilineTextAlignment(.center)
            Button("Retry") { Task { await load() } }
                .font(.caption.weight(.semibold)).foregroundStyle(theme.colors.brandGold)
        }
        .padding(32)
    }

    private func load() async {
        isLoading = true; error = nil
        do {
            let ep = Endpoint(method: .get, path: "api/tasks", queryItems: [URLQueryItem(name: "limit", value: "50")])
            struct R: Decodable { let tasks: [OfficerTask]? }
            let r = try await apiClient.request(ep, as: R.self)
            tasks = r.tasks ?? []
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - CreateTaskSheet

@MainActor
struct CreateTaskSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var description = ""
    @State private var priority = "normal"
    @State private var isBusy = false
    @State private var error: String?

    private let apiClient: APIClient
    private let onCreated: () -> Void

    let priorities = [("normal", "Normal"), ("high", "High"), ("urgent", "Urgent")]

    init(apiClient: APIClient, onCreated: @escaping () -> Void) {
        self.apiClient = apiClient
        self.onCreated = onCreated
    }

    var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 14) {
                        field("TASK TITLE", required: true) {
                            TextField("What needs to be done?", text: $title)
                                .padding(10).background(theme.colors.surfaceMuted)
                                .foregroundStyle(theme.colors.textPrimary)
                                .clipShape(RoundedRectangle(cornerRadius: 2))
                        }
                        field("PRIORITY") {
                            Picker("Priority", selection: $priority) {
                                ForEach(priorities, id: \.0) { p in
                                    Text(p.1).tag(p.0)
                                }
                            }
                            .pickerStyle(.segmented).tint(theme.colors.brandGold)
                        }
                        field("NOTES") {
                            TextEditor(text: $description)
                                .frame(minHeight: 70).padding(8)
                                .background(theme.colors.surfaceMuted)
                                .foregroundStyle(theme.colors.textPrimary).font(.body)
                                .clipShape(RoundedRectangle(cornerRadius: 2))
                        }
                        if let error {
                            Text(error).font(.caption).foregroundStyle(theme.colors.critical)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        Button {
                            Task { await submit() }
                        } label: {
                            Group {
                                if isBusy { ProgressView().tint(theme.colors.surfaceBase) }
                                else { Text("CREATE TASK").font(.headline).tracking(1) }
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .background(!title.trimmingCharacters(in: .whitespaces).isEmpty ? theme.colors.brandGold : theme.colors.surfaceMuted)
                            .foregroundStyle(!title.trimmingCharacters(in: .whitespaces).isEmpty ? theme.colors.surfaceBase : theme.colors.textMuted)
                            .clipShape(RoundedRectangle(cornerRadius: 2))
                        }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || isBusy)
                    }
                    .padding(16)
                }
            }
            .navigationTitle("NEW TASK")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .toolbar {
                ToolbarItem(placement: RmpgToolbarPlacement.trailing.placement) {
                    Button("Cancel") { dismiss() }.font(.caption.weight(.semibold))
                        .foregroundStyle(theme.colors.textMuted)
                }
            }
        }
    }

    private func field<C: View>(_ label: String, required: Bool = false, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Text(label).font(.caption2.weight(.semibold)).tracking(0.5).foregroundStyle(theme.colors.textMuted)
                if required { Text("*").font(.caption2).foregroundStyle(theme.colors.critical) }
            }
            content()
        }
    }

    private func submit() async {
        isBusy = true; error = nil
        do {
            struct Body: Encodable {
                let task_title: String
                let description: String?
                let priority: String
                let task_type: String
            }
            let body = Body(task_title: title.trimmingCharacters(in: .whitespaces),
                           description: description.trimmingCharacters(in: .whitespaces).isEmpty ? nil : description,
                           priority: priority, task_type: "general")
            let ep = try Endpoint.jsonPost("api/tasks", body: body)
            struct R: Decodable { let id: Int? }
            _ = try await apiClient.request(ep, as: R.self)
            onCreated()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        isBusy = false
    }
}

// MARK: - Models

struct OfficerTask: Decodable, Identifiable {
    let id: Int
    let task_title: String
    let description: String?
    let priority: String?
    let status: String
    let due_date: String?
    let assigned_to_name: String?

    var priorityEnum: TaskPriority {
        TaskPriority(rawValue: priority ?? "normal") ?? .normal
    }

    var isOverdue: Bool {
        guard let d = due_date else { return false }
        return d < ISO8601DateFormatter().string(from: Date()).prefix(10).description
    }

    func statusColor(_ theme: ThemeEnvironment) -> Color {
        switch status {
        case "completed":  return theme.colors.success
        case "in_progress": return theme.colors.brandGold
        case "cancelled":  return theme.colors.textMuted
        case "overdue":    return theme.colors.critical
        default:           return theme.colors.textSecondary
        }
    }
}

enum TaskPriority: String, CaseIterable {
    case urgent, high, normal

    var label: String {
        switch self {
        case .urgent: return "URGENT"
        case .high:   return "HIGH"
        case .normal: return "NORMAL"
        }
    }

    func color(_ theme: ThemeEnvironment) -> Color {
        switch self {
        case .urgent: return theme.colors.critical
        case .high:   return theme.colors.warning
        case .normal: return theme.colors.textMuted
        }
    }
}
