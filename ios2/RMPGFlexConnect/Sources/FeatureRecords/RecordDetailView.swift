import SwiftUI



/// Full detail view for a record tapped from search results. Persons and
/// businesses have real `GET /api/records/persons/:id` and
/// `GET /api/records/businesses/:id` endpoints (both verified against
/// src/routes/records.ts — bare row objects). Vehicles have NO per-id detail
/// route anywhere on this Worker (verified via a full grep of src/routes) —
/// rather than guess one and 404, vehicle rows show only what search already
/// returned, honestly labeled as summary-only.
struct RecordDetailView: View {
    let result: SubjectResult
    let client: APIClient

    @State private var person: PersonDetail?
    @State private var business: BusinessDetail?
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            if isLoading {
                ProgressView().tint(RMPGTheme.brandGold)
            } else if let error {
                Text(error).font(.system(size: 12)).foregroundColor(RMPGTheme.statusRed).padding()
            } else if let person {
                personDetail(person)
            } else if let business {
                businessDetail(business)
            } else if result.entityType == "vehicle" {
                vehicleSummaryOnly
            } else {
                Text("Record not found").font(.system(size: 12)).foregroundColor(RMPGTheme.textMuted)
            }
        }
        .navigationTitle(result.name ?? "Record")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var vehicleSummaryOnly: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("VEHICLE — SUMMARY ONLY".uppercased())
                    .font(.system(size: 9, weight: .semibold)).foregroundColor(RMPGTheme.brandGold).tracking(1)
                Text("This Worker doesn't expose a per-vehicle detail endpoint yet — showing what search already returned.")
                    .font(.system(size: 11)).foregroundColor(RMPGTheme.textMuted)
                fieldRow("Label", result.name)
                if let detail = result.detail { fieldRow("Detail", detail) }
                fieldRow("Record ID", "#\(result.id)")
            }
            .padding(16)
        }
    }

    private func personDetail(_ p: PersonDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                section("Identity") {
                    fieldRow("Name", [p.firstName, p.lastName].compactMap { $0 }.joined(separator: " "))
                    fieldRow("Date of Birth", p.dob)
                    fieldRow("Gender", p.gender)
                    fieldRow("Race", p.race)
                    fieldRow("Nationality", p.nationality)
                }
                section("Physical Description") {
                    fieldRow("Height", p.height)
                    fieldRow("Weight", p.weight)
                    fieldRow("Hair Color", p.hairColor)
                    fieldRow("Eye Color", p.eyeColor)
                    fieldRow("Scars/Marks/Tattoos", p.scarsMarksTattoos)
                }
                section("Contact") {
                    fieldRow("Address", p.address)
                    fieldRow("Phone", p.phone)
                    fieldRow("Email", p.email)
                }
                if let flags = p.flagsList, !flags.isEmpty {
                    section("Flags") {
                        Text(flags.joined(separator: ", "))
                            .font(.system(size: 12, weight: .semibold)).foregroundColor(RMPGTheme.statusRed)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                    }
                }
                if let notes = p.notes, !notes.isEmpty {
                    section("Notes") {
                        Text(notes).font(.system(size: 12)).foregroundColor(RMPGTheme.textSecondary)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                    }
                }
            }
            .padding(16)
        }
    }

    private func businessDetail(_ b: BusinessDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                section("Business") {
                    fieldRow("Name", b.name)
                    fieldRow("DBA", b.dbaName)
                    fieldRow("Type", b.businessType)
                    fieldRow("Industry", b.industry)
                    fieldRow("License #", b.licenseNumber)
                }
                section("Location") {
                    fieldRow("Address", b.address)
                    fieldRow("City", b.city)
                    fieldRow("State", b.state)
                    fieldRow("ZIP", b.zip)
                }
                section("Contact") {
                    fieldRow("Phone", b.phone)
                    fieldRow("Email", b.email)
                    fieldRow("Website", b.website)
                    fieldRow("Owner", b.ownerName)
                    fieldRow("Owner Phone", b.ownerPhone)
                    fieldRow("Site Contact", b.contactName)
                    fieldRow("Contact Phone", b.contactPhone)
                }
                if let notes = b.notes, !notes.isEmpty {
                    section("Notes") {
                        Text(notes).font(.system(size: 12)).foregroundColor(RMPGTheme.textSecondary)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                    }
                }
            }
            .padding(16)
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .semibold)).foregroundColor(RMPGTheme.brandGold)
                .tracking(1).padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 4)
            VStack(spacing: 0) { content() }
        }
        .background(RMPGTheme.raisedSurface).cornerRadius(2)
    }

    @ViewBuilder
    private func fieldRow(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            HStack(alignment: .top) {
                Text(label).font(.system(size: 11)).foregroundColor(RMPGTheme.textMuted).frame(width: 120, alignment: .leading)
                Text(value).font(.system(size: 12, weight: .medium)).foregroundColor(RMPGTheme.textPrimary)
                Spacer()
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
            Divider().background(RMPGTheme.borderSubtle)
        }
    }

    private func load() async {
        switch result.entityType {
        case "person":
            do {
                person = try await client.request(Endpoint(path: "/api/records/persons/\(result.id)"))
            } catch {
                self.error = "Could not load person: \(error.localizedDescription)"
            }
        case "business":
            do {
                business = try await client.request(Endpoint(path: "/api/records/businesses/\(result.id)"))
            } catch {
                self.error = "Could not load business: \(error.localizedDescription)"
            }
        default:
            break // vehicle: no detail endpoint, vehicleSummaryOnly renders from `result` directly
        }
        isLoading = false
    }
}

/// Mirrors the real `persons` base columns + the small `persons_ext` overflow
/// table (migrations/0001_initial_schema.sql, migrations/0081_persons_ext.sql).
/// `flags` is stored as a JSON-array-encoded STRING column, not a native
/// array, so it's decoded as a string and parsed client-side.
struct PersonDetail: Codable, Sendable {
    let id: Int
    let firstName: String?
    let lastName: String?
    let dob: String?
    let gender: String?
    let race: String?
    let height: String?
    let weight: String?
    let hairColor: String?
    let eyeColor: String?
    let scarsMarksTattoos: String?
    let address: String?
    let phone: String?
    let email: String?
    let flags: String?
    let notes: String?
    let suffix: String?
    let nationality: String?

    var flagsList: [String]? {
        guard let flags, let data = flags.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode([String].self, from: data)
    }
}

/// Mirrors the real `businesses` table (migrations/0023_business_records.sql).
struct BusinessDetail: Codable, Sendable {
    let id: Int
    let name: String?
    let dbaName: String?
    let businessType: String?
    let licenseNumber: String?
    let address: String?
    let city: String?
    let state: String?
    let zip: String?
    let phone: String?
    let email: String?
    let website: String?
    let ownerName: String?
    let ownerPhone: String?
    let contactName: String?
    let contactPhone: String?
    let contactEmail: String?
    let industry: String?
    let notes: String?
}
