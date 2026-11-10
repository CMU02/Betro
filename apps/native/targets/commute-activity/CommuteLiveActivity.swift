import ActivityKit
import SwiftUI
import WidgetKit

@main
struct CommuteActivityBundle: WidgetBundle {
  var body: some Widget {
    CommuteLiveActivity()
  }
}

/// 값이 들어오는지만 보이는 임시 화면. 문구와 레이아웃은 Task 4의 `CommuteViews`가 대신한다.
struct CommuteLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: CommuteActivityAttributes.self) { context in
      VStack(alignment: .leading, spacing: 4) {
        Text(context.state.lineName).font(.headline)
        Text(context.state.stopName)
        if let stopsAway = context.state.stopsAway {
          Text(verbatim: "\(stopsAway)")
        }
        if let etaEpoch = context.state.etaEpoch {
          Text(Date(timeIntervalSince1970: etaEpoch), style: .time)
        }
      }
      .padding()
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) { Text(context.state.lineName) }
        DynamicIslandExpandedRegion(.trailing) {
          if let etaEpoch = context.state.etaEpoch {
            Text(Date(timeIntervalSince1970: etaEpoch), style: .time)
          }
        }
        DynamicIslandExpandedRegion(.bottom) { Text(context.state.stopName) }
      } compactLeading: {
        Text(context.state.lineName)
      } compactTrailing: {
        if let stopsAway = context.state.stopsAway {
          Text(verbatim: "\(stopsAway)")
        }
      } minimal: {
        Image(systemName: context.state.mode == "subway" ? "tram.fill" : "bus.fill")
      }
    }
  }
}
