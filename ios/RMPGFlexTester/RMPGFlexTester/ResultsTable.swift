import SwiftUI

struct ResultsTable: View {
    let result: D1QueryResult

    var body: some View {
        if result.columns.isEmpty {
            Text("No rows")
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(Theme.neutral)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding()
        } else {
            ScrollView([.horizontal, .vertical]) {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 2) {
                    GridRow {
                        ForEach(result.columns, id: \.self) { col in
                            Text(col.uppercased())
                                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                .foregroundStyle(Theme.gold)
                        }
                    }
                    Divider().gridCellUnsizedAxes(.horizontal)
                    ForEach(Array(result.rows.enumerated()), id: \.offset) { _, row in
                        GridRow {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                Text(cell)
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(cell == "NULL" ? Theme.neutral : .white)
                                    .lineLimit(1)
                            }
                        }
                    }
                }
                .padding(8)
            }
            .background(Theme.sunken)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
    }
}
