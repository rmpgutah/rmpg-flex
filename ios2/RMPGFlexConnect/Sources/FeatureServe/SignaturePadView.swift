import SwiftUI


/// Finger-drawn signature capture for proof-of-service. Renders to a PNG and
/// returns raw base64 (no `data:image/png;base64,` prefix) — that's the shape
/// `serve_attempts.signature_data` stores on the Worker; the web client only
/// adds the data-URI prefix when displaying it in an `<img>` tag.
public struct SignaturePadView: View {
    @State private var lines: [[CGPoint]] = []
    @State private var currentLine: [CGPoint] = []
    let onCapture: (String) -> Void
    let onCancel: () -> Void

    private let canvasSize = CGSize(width: 340, height: 200)

    public init(onCapture: @escaping (String) -> Void, onCancel: @escaping () -> Void) {
        self.onCapture = onCapture
        self.onCancel = onCancel
    }

    public var body: some View {
        VStack(spacing: 16) {
            Text("SIGNATURE".uppercased())
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(RMPGTheme.brandGold)
                .tracking(2)

            ZStack {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.white)
                    .frame(width: canvasSize.width, height: canvasSize.height)

                Canvas { context, _ in
                    for line in lines + [currentLine] {
                        var path = Path()
                        guard let first = line.first else { continue }
                        path.move(to: first)
                        for point in line.dropFirst() { path.addLine(to: point) }
                        context.stroke(path, with: .color(.black), style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                    }
                }
                .frame(width: canvasSize.width, height: canvasSize.height)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in currentLine.append(value.location) }
                        .onEnded { _ in
                            lines.append(currentLine)
                            currentLine = []
                        }
                )
            }
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(RMPGTheme.borderDefault, lineWidth: 1))

            HStack(spacing: 12) {
                Button("Clear") { lines = []; currentLine = [] }
                    .font(.system(size: 12)).foregroundColor(RMPGTheme.textMuted)

                Spacer()

                Button("Cancel", action: onCancel)
                    .font(.system(size: 12)).foregroundColor(RMPGTheme.textMuted)

                Button {
                    if let base64 = renderBase64() { onCapture(base64) }
                } label: {
                    Text("USE SIGNATURE")
                        .font(.system(size: 12, weight: .semibold))
                        .padding(.horizontal, 16).padding(.vertical, 8)
                        .background(lines.isEmpty ? RMPGTheme.borderDefault : RMPGTheme.brandGold)
                        .foregroundColor(lines.isEmpty ? RMPGTheme.textMuted : .black)
                        .cornerRadius(2)
                }
                .disabled(lines.isEmpty)
            }
        }
        .padding(20)
        .background(RMPGTheme.raisedSurface)
        .cornerRadius(4)
    }

    private func renderBase64() -> String? {
        let renderer = ImageRenderer(content:
            ZStack {
                Color.white
                Canvas { context, _ in
                    for line in lines {
                        var path = Path()
                        guard let first = line.first else { continue }
                        path.move(to: first)
                        for point in line.dropFirst() { path.addLine(to: point) }
                        context.stroke(path, with: .color(.black), style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                    }
                }
            }
            .frame(width: canvasSize.width, height: canvasSize.height)
        )
        renderer.scale = 2
        guard let uiImage = renderer.uiImage, let pngData = uiImage.pngData() else { return nil }
        return pngData.base64EncodedString()
    }
}
