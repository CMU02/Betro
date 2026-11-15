import ActivityKit
import SwiftUI
import WidgetKit

@main
struct CommuteActivityBundle: WidgetBundle {
  var body: some Widget {
    CommuteLiveActivity()
  }
}

/// 확장 번들의 `ko.lproj/Localizable.strings`에서 문구를 찾는다(원본은 `messages-ko.ts`의 `commute.lock.*`).
/// MVP의 언어는 한국어 하나라 기기 언어와 상관없이 `ko.lproj`를 읽어 키가 그대로 보이지 않게 한다.
enum CommuteStrings {
  static let bundle: Bundle =
    Bundle.main.path(forResource: "ko", ofType: "lproj").flatMap(Bundle.init(path:)) ?? .main

  static func translate(_ key: String, _ params: [String: String]) -> String {
    var text = bundle.localizedString(forKey: key, value: nil, table: nil)
    for (name, value) in params {
      text = text.replacingOccurrences(of: "{\(name)}", with: value)
    }
    return text
  }
}

struct CommuteLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: CommuteActivityAttributes.self) { context in
      CommuteLockScreenView(model: Self.model(for: context), state: context.state)
    } dynamicIsland: { context in
      let model = Self.model(for: context)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          CommuteIsland.expandedTop(model: model, state: context.state)
        }
        DynamicIslandExpandedRegion(.bottom) {
          CommuteIsland.expandedBottom(model: model, state: context.state)
        }
      } compactLeading: {
        CommuteIsland.compactLeading(model: model)
      } compactTrailing: {
        CommuteIsland.compactTrailing(model: model)
      } minimal: {
        CommuteIsland.minimal(model: model)
      }
    }
  }

  /// 머리줄은 앱이 `setPlanHeaders`로 앱 그룹에 둔 값이고, 없으면 "출퇴근"이다.
  /// 시각은 기기 시간대로 쓴다. 갱신이 끊긴 Activity(`isStale`)는 태그를 "시간표 추정"으로 바꾼다.
  static func model(for context: ActivityViewContext<CommuteActivityAttributes>) -> CommuteLockModel {
    let model = CommuteCopy.model(
      state: context.state,
      now: Date(),
      header: CommuteSharedStore.planHeader(planId: context.attributes.planId),
      timeZone: .current,
      t: CommuteStrings.translate
    )
    return context.isStale ? CommuteCopy.markedStale(model, t: CommuteStrings.translate) : model
  }
}
