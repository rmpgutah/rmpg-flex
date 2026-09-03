import SwiftUI



struct ServeJobDetailView: View {
    let jobId: Int
    let api: ServeAPI

    @State private var job: ServeJob?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showLogAttempt = false

    var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            if isLoading {
                ProgressView().tint(RMPGTheme.brandGold)
            } else if let job {
                content(job)
            } else {
                Text(errorMessage ?? "Job not found")
                    .font(.system(size: 12)).foregroundColor(RMPGTheme.statusRed)
            }
        }
        .navigationTitle("Serve Job")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(isPresented: $showLogAttempt) {
            if let job {
                LogAttemptSheet(job: job, api: api) {
                    Task { await load() }
                }
            }
        }
    }

    private func content(_ job: ServeJob) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    if let p = job.priority { StatusBadge.priority(p) }
                    StatusBadge(text: (job.status ?? "pending").replacingOccurrences(of: "_", with: " ").capitalized, color: RMPGTheme.textSecondary)
                    Spacer()
                    if let n = job.attemptCount {
                        Text("Attempt \(n) of \(job.maxAttempts ?? 3)").font(.system(size: 11)).foregroundColor(RMPGTheme.textMuted)
                    }
                }

                Text(job.recipientName ?? "Unknown Recipient")
                    .font(.system(size: 18, weight: .bold)).foregroundColor(RMPGTheme.textPrimary)

                workflowBanner(job)

                infoSection {
                    row(icon: "location.fill", text: job.fullAddress.isEmpty ? "No address on file" : job.fullAddress)
                    if let instructions = job.serviceInstructions, !instructions.isEmpty {
                        row(icon: "note.text", text: instructions)
                    }
                }

                if !job.fullAddress.isEmpty {
                    Button {
                        openInMaps(job.fullAddress)
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "map.fill")
                            Text("NAVIGATE TO ADDRESS").font(.system(size: 12, weight: .semibold))
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(RMPGTheme.raisedSurface).foregroundColor(RMPGTheme.brandGold).cornerRadius(2)
                        .overlay(RoundedRectangle(cornerRadius: 2).stroke(RMPGTheme.brandGold.opacity(0.4), lineWidth: 1))
                    }
                }

                infoSection {
                    labelRow("Document", job.documentType)
                    labelRow("Case #", job.caseNumber)
                    labelRow("Court", job.courtName)
                    labelRow("Jurisdiction", job.jurisdiction)
                    labelRow("Client", job.clientName)
                    labelRow("Attorney", job.attorneyName)
                    labelRow("Deadline", job.deadline.map { String($0.prefix(10)) })
                    labelRow("Time Window", job.timeWindow)
                }

                if let notes = job.notes, !notes.isEmpty {
                    infoSection { row(icon: "text.bubble", text: notes) }
                }

                if !isTerminal(job.status) {
                    Button {
                        showLogAttempt = true
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.shield.fill")
                            Text((job.attemptCount ?? 0) == 0 ? "LOG FIRST ATTEMPT" : "LOG NEXT ATTEMPT").font(.system(size: 13, weight: .semibold))
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(RMPGTheme.brandGold).foregroundColor(.black).cornerRadius(2)
                    }
                }

                if let attempts = job.attempts, !attempts.isEmpty {
                    Text("ATTEMPT HISTORY".uppercased())
                        .font(.system(size: 10, weight: .semibold)).foregroundColor(RMPGTheme.textMuted).tracking(1)
                    VStack(spacing: 0) {
                        ForEach(attempts) { attempt in
                            attemptRow(attempt)
                            if attempt.id != attempts.last?.id { Divider().background(RMPGTheme.borderSubtle) }
                        }
                    }
                    .background(RMPGTheme.raisedSurface).cornerRadius(2)
                }
            }
            .padding(16)
        }
    }

    /// Process-server workflow: unlike a CFS's strict linear status line,
    /// a serve job's real states (pending/assigned/in_progress/served/
    /// failed/attempted/cancelled — src/routes/serve.ts's STATUSES) branch
    /// on the attempt outcome rather than advancing forward-only, so this is
    /// a guidance banner rather than a rigid stepper: it tells the officer
    /// what to do right now, given how many attempts remain.
    @ViewBuilder
    private func workflowBanner(_ job: ServeJob) -> some View {
        let attempts = job.attemptCount ?? 0
        let maxAttempts = job.maxAttempts ?? 3
        let status = job.status ?? "pending"

        HStack(spacing: 8) {
            Image(systemName: bannerIcon(status))
            Text(bannerText(status: status, attempts: attempts, maxAttempts: maxAttempts))
                .font(.system(size: 12, weight: .semibold))
        }
        .foregroundColor(bannerColor(status))
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(bannerColor(status).opacity(0.12)).cornerRadius(2)
    }

    private func isTerminal(_ status: String?) -> Bool {
        status == "served" || status == "failed"
    }

    private func bannerIcon(_ status: String) -> String {
        switch status {
        case "served": return "checkmark.seal.fill"
        case "failed": return "xmark.seal.fill"
        default: return "figure.walk"
        }
    }

    private func bannerColor(_ status: String) -> Color {
        switch status {
        case "served": return RMPGTheme.statusGreen
        case "failed": return RMPGTheme.statusRed
        default: return RMPGTheme.brandGold
        }
    }

    private func bannerText(status: String, attempts: Int, maxAttempts: Int) -> String {
        switch status {
        case "served": return "Job complete — served."
        case "failed": return "Job closed — not served after \(attempts) attempt\(attempts == 1 ? "" : "s")."
        default:
            let remaining = max(0, maxAttempts - attempts)
            if attempts == 0 { return "Navigate to the address, then log the first attempt." }
            return "\(remaining) attempt\(remaining == 1 ? "" : "s") remaining before due diligence is exhausted."
        }
    }

    private func openInMaps(_ address: String) {
        guard let encoded = address.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "http://maps.apple.com/?address=\(encoded)") else { return }
        UIApplication.shared.open(url)
    }

    private func infoSection<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) { content() }
            .padding(12).background(RMPGTheme.raisedSurface).cornerRadius(2)
    }

    private func row(icon: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: icon).font(.system(size: 11)).foregroundColor(RMPGTheme.statusRed).padding(.top, 1)
            Text(text).font(.system(size: 12)).foregroundColor(RMPGTheme.textSecondary)
        }
    }

    @ViewBuilder
    private func labelRow(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            HStack {
                Text(label).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted).frame(width: 90, alignment: .leading)
                Text(value).font(.system(size: 12)).foregroundColor(RMPGTheme.textPrimary)
                Spacer()
            }
        }
    }

    private func attemptRow(_ attempt: ServeAttempt) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("#\(attempt.attemptNumber ?? 0) — \((attempt.result ?? "unknown").replacingOccurrences(of: "_", with: " ").capitalized)")
                    .font(.system(size: 12, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
                Spacer()
                if let date = attempt.attemptAt { Text(String(date.prefix(16))).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted) }
            }
            if let officer = attempt.officerName { Text(officer).font(.system(size: 11)).foregroundColor(RMPGTheme.textSecondary) }
            if let notes = attempt.notes, !notes.isEmpty { Text(notes).font(.system(size: 11)).foregroundColor(RMPGTheme.textSecondary) }
        }
        .padding(12)
    }

    private func load() async {
        isLoading = true
        do {
            job = try await api.getJob(id: jobId)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
