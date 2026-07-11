import CarPlay
import UIKit
import MapKit
import CoreAPI

/// The CarPlay entry point for RMPG Flex Connect, registered as the
/// `CPTemplateApplicationSceneSessionRoleApplication` scene delegate class
/// in the app target's Info.plist under `UIApplicationSceneManifest`. iOS
/// resolves this class by Objective-C runtime name from that plist entry,
/// so it must be `public` and inherit from `UIResponder` (matching the
/// pattern of every other `UIApplicationDelegate`/`UISceneDelegate` in the
/// app) for the lookup to succeed, in addition to conforming to
/// `CPTemplateApplicationSceneDelegate`.
///
/// Written against the documented CarPlay API surface but NOT
/// compile-verified in this session — the `CarPlay` framework only exists
/// on iOS / the CarPlay Simulator, not in a standalone `swift build`, and
/// `xcodebuild` hangs in this sandbox (a pre-existing, documented
/// limitation). In particular, the exact argument labels/types for
/// `CPTrip`, `CPManeuver`, `CPTravelEstimates`, and `CPRouteChoice` should
/// be double-checked against the real SDK in Xcode before shipping.
public final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interfaceController: CPInterfaceController?
    private let apiClient = APIClient(baseURL: Endpoint.productionBaseURL)
    private var navigationSession: CPNavigationSession?

    public override init() {
        super.init()
    }

    public func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController
        Task { await showRootTemplates() }
    }

    public func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = nil
        navigationSession = nil
    }

    @MainActor
    private func showRootTemplates() async {
        let listTemplate = await buildCallListTemplate()
        listTemplate.tabTitle = "Calls"
        listTemplate.tabImage = UIImage(systemName: "list.bullet")

        let quickReplyTemplate = buildQuickReplyTemplate()
        quickReplyTemplate.tabTitle = "Updates"
        quickReplyTemplate.tabImage = UIImage(systemName: "bubble.left.and.bubble.right")

        let tabBar = CPTabBarTemplate(templates: [listTemplate, quickReplyTemplate])
        interfaceController?.setRootTemplate(tabBar, animated: true, completion: nil)
    }

    /// Fetches active calls directly via `APIClient`/`Endpoint` rather than
    /// depending on `FeatureDispatch`'s `DispatchAPI` — this package can't
    /// path-depend on a root-package-only target (see
    /// `CarPlayCallListBuilder.swift`'s doc comment) — and maps the raw
    /// `{data: [...], pagination: ...}` wire shape (confirmed against
    /// `DispatchAPI.listCalls`/`ApiListResponse`) into the local
    /// `CarPlayCall` model.
    @MainActor
    private func fetchActiveCalls() async -> [CarPlayCall] {
        struct RawCall: Decodable {
            let id: Int
            let callNumber: String?
            let incidentType: String?
            let priority: String?
            let status: String?
            let latitude: Double?
            let longitude: Double?
        }
        struct Response: Decodable { let data: [RawCall] }
        struct DutyUnit: Decodable { let id: Int }
        struct DutyState: Decodable { let unit: DutyUnit? }

        await syncAuthToken()

        // `GET /api/dispatch/calls` with no scoping param returns EVERY
        // non-archived agency call to any authenticated caller — fine for
        // the dispatch/supervisor web UI, wrong for a driving-safety-
        // sensitive dashboard surface. `/api/dispatch/duty/me` returns the
        // signed-in officer's own claimed unit, which we pass as `unit_id`
        // so the server scopes the list to calls actually assigned to this
        // officer's unit instead of the whole agency queue.
        let dutyState: DutyState? = try? await apiClient.request(
            Endpoint(path: "/api/dispatch/duty/me")
        )

        var queryItems = [URLQueryItem(name: "active", value: "true")]
        if let unitId = dutyState?.unit?.id {
            queryItems.append(URLQueryItem(name: "unit_id", value: String(unitId)))
        }

        guard let response: Response = try? await apiClient.request(
            Endpoint(path: "/api/dispatch/calls", queryItems: queryItems)
        ) else { return [] }

        return response.data
            .compactMap(\.value)
            .filter { ["dispatched", "enroute", "onscene"].contains($0.status ?? "") }
            .map {
                CarPlayCall(
                    id: $0.id,
                    callNumber: $0.callNumber,
                    incidentType: $0.incidentType,
                    priority: $0.priority,
                    status: $0.status,
                    latitude: $0.latitude,
                    longitude: $0.longitude
                )
            }
    }

    @MainActor
    private func buildCallListTemplate() async -> CPListTemplate {
        let calls = await fetchActiveCalls()
        let items = calls.map { call -> CPListItem in
            let (title, detail) = CarPlayCallListBuilder.displayText(for: call)
            let item = CPListItem(text: title, detailText: detail)
            item.handler = { [weak self] _, completion in
                Task { await self?.startNavigation(to: call) }
                completion()
            }
            return item
        }
        return CPListTemplate(title: "Active Calls", sections: [CPListSection(items: items)])
    }

    private func buildQuickReplyTemplate() -> CPGridTemplate {
        let buttons = CannedMessage.allCases.map { message -> CPGridButton in
            CPGridButton(
                titleVariants: [message.text],
                image: UIImage(systemName: "checkmark.circle.fill") ?? UIImage()
            ) { [weak self] _ in
                Task { await self?.sendQuickReply(message) }
            }
        }
        return CPGridTemplate(title: "Send Update", gridButtons: buttons)
    }

    /// Posts `/api/mdt/send` with the exact body `CarPlayQuickReplyPayload.mdtSendPayload`
    /// builds — `{to: 'mdt', type: 'text', payload: {text: "..."}}` — matching what
    /// MDTLinkView's Quick Actions already send.
    private func sendQuickReply(_ message: CannedMessage) async {
        await syncAuthToken()

        let payload = CarPlayQuickReplyPayload.mdtSendPayload(text: message.text)
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return }
        try? await apiClient.requestVoid(Endpoint(path: "/api/mdt/send", method: .post, body: body))
    }

    /// `APIClient` is a fresh actor instance owned by this scene delegate —
    /// it has no constructor param or token-provider closure, so
    /// `setAuthToken(_:)` is the ONLY way it ever learns the signed-in user's
    /// token (see `Sources/CoreAPI/APIClient.swift`/`AuthManager.swift`).
    /// Without this, every CarPlay request 401s silently (both call sites
    /// swallow errors via `try?`), so the call list stays empty and quick
    /// replies never actually send. Re-reading the keychain before each
    /// request (rather than once on `didConnect`) is cheap and also picks up
    /// a token rotated mid-session. `PersistentAuth` (same `CoreAPI` module)
    /// reads from the app's own private keychain — no App Group needed,
    /// reachable from any scene in this process — the same pattern
    /// `FeatureQuickActions`'s `RunPlateAPIClient` wiring already uses.
    private func syncAuthToken() async {
        await apiClient.setAuthToken(PersistentAuth().storedToken())
    }

    @MainActor
    private func startNavigation(to call: CarPlayCall) async {
        guard let coordinate = CarPlayNavigationCoordinator.destinationCoordinate(for: call) else { return }

        let request = MKDirections.Request()
        request.source = MKMapItem.forCurrentLocation()
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: coordinate))
        request.transportType = .automobile

        guard let route = try? await MKDirections(request: request).calculate().routes.first,
              let destination = request.destination else { return }

        let mapTemplate = CPMapTemplate()
        let routeChoice = CPRouteChoice(
            summaryVariants: [route.name],
            additionalInformationVariants: [],
            selectionSummaryVariants: []
        )
        let trip = CPTrip(origin: MKMapItem.forCurrentLocation(), destination: destination, routeChoices: [routeChoice])
        let session = mapTemplate.startNavigationSession(for: trip)
        navigationSession = session

        session.upcomingManeuvers = route.steps.dropFirst().map { step in
            let maneuver = CPManeuver()
            maneuver.instructionVariants = [step.instructions]
            maneuver.initialTravelEstimates = CPTravelEstimates(
                distanceRemaining: Measurement(value: step.distance, unit: .meters),
                timeRemaining: -1
            )
            return maneuver
        }

        interfaceController?.pushTemplate(mapTemplate, animated: true, completion: nil)
    }
}
