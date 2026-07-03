import Foundation

@MainActor
public final class WebSocketClient: ObservableObject {
    @Published public private(set) var connectionState: ConnectionState = .disconnected

    private var task: URLSessionWebSocketTask?
    private var session: URLSession
    private var authToken: String
    private var pingTimer: Timer?
    private var reconnectTimer: Timer?
    private let wsURL: String

    public var onDispatchUpdate: ((DispatchUpdateMessage) -> Void)?
    public var onWelfareCheck: ((WelfareCheckMessage) -> Void)?
    public var onError: ((String) -> Void)?

    public enum ConnectionState: Sendable {
        case disconnected
        case connecting
        case connected
        case authenticating
    }

    public init(wsURL: String = "wss://api.rmpgutah.us/api/ws", authToken: String) {
        self.wsURL = wsURL
        self.authToken = authToken
        self.session = URLSession(configuration: .default)
    }

    public func updateToken(_ token: String) {
        authToken = token
    }

    public func connect() {
        guard connectionState == .disconnected else { return }
        connectionState = .connecting

        guard let url = URL(string: wsURL) else {
            onError?("Invalid WebSocket URL")
            return
        }

        task?.cancel()
        task = session.webSocketTask(with: url)
        task?.resume()
        authenticate()
    }

    public func disconnect() {
        reconnectTimer?.invalidate()
        pingTimer?.invalidate()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        connectionState = .disconnected
    }

    private func authenticate() {
        connectionState = .authenticating
        let authMsg = """
        {"type":"authenticate","token":"\(authToken)"}
        """
        task?.send(.string(authMsg)) { [weak self] error in
            Task { @MainActor in
                guard let self else { return }
                if let error = error {
                    self.onError?("Auth failed: \(error.localizedDescription)")
                    self.connectionState = .disconnected
                    self.scheduleReconnect()
                    return
                }
                self.connectionState = .connected
                self.startPing()
                self.receive()
            }
        }
    }

    private func receive() {
        task?.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .success(let message):
                    self.handleMessage(message)
                    self.receive()
                case .failure(let error):
                    self.onError?("WS error: \(error.localizedDescription)")
                    self.connectionState = .disconnected
                    self.scheduleReconnect()
                }
            }
        }
    }

    private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .string(let text):
            guard let data = text.data(using: .utf8) else { return }
            do {
                let decoder = JSONDecoder()
                if let base = try? decoder.decode(BaseMessage.self, from: data) {
                    switch base.type {
                    case "authenticated":
                        connectionState = .connected
                    case "dispatch_update":
                        if let update = try? decoder.decode(DispatchUpdateMessage.self, from: data) {
                            onDispatchUpdate?(update)
                        }
                    case "welfare_check":
                        if let welfare = try? decoder.decode(WelfareCheckMessage.self, from: data) {
                            onWelfareCheck?(welfare)
                        }
                    case "error":
                        if let err = try? decoder.decode(ErrorBody.self, from: data) {
                            onError?(err.message)
                            if err.code == 4002 {
                                connectionState = .disconnected
                            }
                        }
                    default:
                        break
                    }
                }
            }
        case .data(let data):
            if let text = String(data: data, encoding: .utf8) {
                handleMessage(.string(text))
            }
        @unknown default:
            break
        }
    }

    private func startPing() {
        pingTimer?.invalidate()
        pingTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.task?.sendPing { _ in }
            }
        }
    }

    private func scheduleReconnect() {
        reconnectTimer?.invalidate()
        reconnectTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.connect()
            }
        }
    }

    struct BaseMessage: Codable {
        let type: String
    }

    struct ErrorBody: Codable {
        let code: Int?
        let message: String
    }
}

// MARK: - Message Types

public struct DispatchUpdateMessage: Codable, Sendable {
    public let type: String
    public let action: String
    public let userId: Int?
    public let callSign: String?
    public let callId: Int?
    public let callNumber: String?
    public let triggeredBy: Int?
    public let at: String?
}

public struct WelfareCheckMessage: Codable, Sendable {
    public let type: String
    public let action: String
    public let callSign: String?
    public let callId: Int?
    public let callNumber: String?
    public let message: String?
}
