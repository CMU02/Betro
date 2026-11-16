import Foundation

/// 지금 구간 뒤에 남은 구간 한 줄(TS `LockScreenNextLeg`).
public struct CommuteLockNextLeg: Hashable {
  public var lineName: String
  /// "bus" | "subway"
  public var mode: String
  public var text: String
}

/// 잠금화면 카드와 다이내믹 아일랜드가 그리는 값(TS `LockScreenModel`에서 iOS에 없는 `actions`를 뺀 것).
public struct CommuteLockModel: Hashable {
  public var detail: String
  public var header: String
  public var lineName: String
  /// "bus" | "subway"
  public var mode: String
  public var status: String
  /// "live" | "estimated" | "delayed"
  public var tag: String
  public var tagLabel: String
  public var minutes: String?
  /// 남은 분을 시스템 타이머로 셀 끝 시각(epoch 초). `minutes`가 "N분"일 때만 있고 "곧"·시각 없음이면 nil(TS `countdownEpoch`).
  public var countdownEpoch: Double?
  public var suggestion: String?
  /// 남은 구간이 3개 이상이면 "외 {n}구간"(n = 남은 수 - 2).
  public var moreLegs: String?
  /// 최대 2줄.
  public var nextLegs: [CommuteLockNextLeg]
}

/// 푸시 값을 잠금화면 문구로 바꾸는 규칙. `apps/native/lib/commute/lock-screen-model.ts`와 같은 규칙이고,
/// `scripts/check-lock-copy-swift.sh`가 `lock-screen-cases.json`의 기대값과 글자 그대로 맞는지 본다.
/// 위젯 확장은 JS를 돌릴 수 없어서 같은 규칙을 한 번 더 구현한다. Foundation만 쓴다(맥에서 대조하려고).
public enum CommuteCopy {
  /// 키(`commute.lock.*`)와 `{이름}` 자리표시자 값을 받아 문구를 돌려준다.
  public typealias Translate = (String, [String: String]) -> String

  static let secondsPerMinute = 60.0
  static let delayedMinutes = 5
  static let maxNextLegLines = 2

  public static func model(
    state: CommuteActivityAttributes.ContentState,
    now: Date,
    header: String?,
    timeZone: TimeZone,
    t: Translate
  ) -> CommuteLockModel {
    let nowEpoch = now.timeIntervalSince1970
    let clock = clockFormatter(timeZone: timeZone)
    let tag = tagOf(state)
    // 상세·남은 시간은 출발 대기 중이면 시각 없이 그린다. 상태 줄은 원래 값으로 정한다.
    var timed = state
    if showsAwaitingDeparture(state, now: nowEpoch) {
      timed.etaEpoch = nil
    }
    return CommuteLockModel(
      detail: detailLine(timed, now: nowEpoch, clock: clock, t: t),
      header: header ?? t("commute.lock.header.fallback", [:]),
      lineName: state.lineName,
      mode: state.mode,
      status: statusLine(state, now: nowEpoch, clock: clock, t: t),
      tag: tag,
      tagLabel: t("commute.lock.tag.\(tag)", [:]),
      minutes: minutesLabel(timed, now: nowEpoch, t: t),
      countdownEpoch: countdownEpoch(timed, now: nowEpoch),
      suggestion: suggestionLine(state, now: nowEpoch, t: t),
      moreLegs: moreLegsLine(state, t: t),
      nextLegs: nextLegLines(state, clock: clock, t: t)
    )
  }

  /// `context.isStale`(갱신이 끊긴 Activity)이면 태그를 "시간표 추정"으로 바꾼다.
  public static func markedStale(_ model: CommuteLockModel, t: Translate) -> CommuteLockModel {
    var stale = model
    stale.tag = "estimated"
    stale.tagLabel = t("commute.lock.tag.estimated", [:])
    return stale
  }

  // MARK: - 시각

  /// 24시간 `HH:mm`(TS `formatClock`과 같다).
  static func clockFormatter(timeZone: TimeZone) -> (Double) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = timeZone
    formatter.dateFormat = "HH:mm"
    return { epoch in formatter.string(from: Date(timeIntervalSince1970: epoch)) }
  }

  static func knownStops(_ stopsAway: Int?) -> Int? {
    guard let stopsAway, stopsAway >= 0 else { return nil }
    return stopsAway
  }

  /// "지나갔어요"를 쓰는 경우. 나가기 전 문구보다 앞선다.
  static func showsPassed(_ state: CommuteActivityAttributes.ContentState) -> Bool {
    state.passed != nil && state.etaEpoch != nil
  }

  /// 새 도착판에서 탈 차량이 아직 기점에서 떠나지 않았다. 묵은 위치에서는 "위치 확인 중"을 둔다.
  static func awaitsDeparture(_ state: CommuteActivityAttributes.ContentState) -> Bool {
    state.awaitingDeparture == true && state.positionState == "live"
  }

  /// "출발 대기 중"을 쓰는 경우. 이때 탈 시각은 차량 없이 낸 값이라 1분마다 같이 밀려서
  /// 시각·남은 시간·타이머를 보이지 않는다(TS `showsAwaitingDeparture`).
  static func showsAwaitingDeparture(_ state: CommuteActivityAttributes.ContentState, now: Double) -> Bool {
    (state.stage == "walk" || state.stage == "wait")
      && awaitsDeparture(state)
      && knownStops(state.stopsAway) == nil
      && !showsPassed(state)
      && beforeLeave(state, now: now) == nil
  }

  /// 첫 구간 walk 단계에서 나가는 시각이 아직 오지 않았으면 그 시각과 탑승 시각.
  static func beforeLeave(
    _ state: CommuteActivityAttributes.ContentState,
    now: Double
  ) -> (etaEpoch: Double, leaveEpoch: Double)? {
    guard
      !showsPassed(state),
      state.stage == "walk",
      state.legIndex == 0,
      let leaveEpoch = state.leaveEpoch,
      let etaEpoch = state.etaEpoch,
      now < leaveEpoch
    else { return nil }
    return (etaEpoch, leaveEpoch)
  }

  // MARK: - 줄

  static func statusLine(
    _ state: CommuteActivityAttributes.ContentState,
    now: Double,
    clock: (Double) -> String,
    t: Translate
  ) -> String {
    if let passed = state.passed, state.etaEpoch != nil {
      let key = state.mode == "subway"
        ? "commute.lock.status.passedSubway"
        : "commute.lock.status.passedBus"
      return t(key, ["passedLine": passed.lineName])
    }
    if let leave = beforeLeave(state, now: now) {
      return t("commute.lock.status.beforeLeave", ["leave": clock(leave.leaveEpoch)])
    }
    let stops = knownStops(state.stopsAway)
    if state.stage == "walk" || state.stage == "wait" {
      guard let stops else {
        return awaitsDeparture(state)
          ? t("commute.lock.status.awaitingDeparture", [:])
          : t("commute.lock.status.unknown", [:])
      }
      return stops >= 1
        ? t("commute.lock.status.stopsAway", ["n": String(stops)])
        : t("commute.lock.status.arriving", [:])
    }
    if state.stage == "ride" {
      guard let stops else { return t("commute.lock.status.rideUnknown", [:]) }
      return stops >= 1
        ? t("commute.lock.status.ride", ["n": String(stops)])
        : t("commute.lock.status.rideLast", [:])
    }
    return t("commute.lock.status.arrived", ["stop": state.stopName])
  }

  /// 지나간 차 다음 차의 시각은 상태 줄이 아니라 상세 줄에 둔다(Figma `1구간 지나감`).
  static func passedDetailKey(_ state: CommuteActivityAttributes.ContentState) -> String {
    let estimated = state.etaState != "live"
    if state.mode == "subway" {
      return estimated
        ? "commute.lock.detail.passedSubwayEstimated"
        : "commute.lock.detail.passedSubway"
    }
    return estimated
      ? "commute.lock.detail.passedBusEstimated"
      : "commute.lock.detail.passedBus"
  }

  static func detailLine(
    _ state: CommuteActivityAttributes.ContentState,
    now: Double,
    clock: (Double) -> String,
    t: Translate
  ) -> String {
    if showsPassed(state), let etaEpoch = state.etaEpoch {
      return t(passedDetailKey(state), ["eta": clock(etaEpoch), "stop": state.stopName])
    }
    if let leave = beforeLeave(state, now: now) {
      return t("commute.lock.detail.beforeLeave", ["eta": clock(leave.etaEpoch), "stop": state.stopName])
    }
    guard let etaEpoch = state.etaEpoch else {
      return t("commute.lock.detail.noEta", ["stop": state.stopName])
    }
    let key = state.etaState == "live"
      ? "commute.lock.detail.eta"
      : "commute.lock.detail.etaEstimated"
    return t(key, ["eta": clock(etaEpoch), "stop": state.stopName])
  }

  /// 남은 분을 보일 때 그 기준 시각. 도착했거나 끝났으면 없다.
  static func minutesEta(_ state: CommuteActivityAttributes.ContentState) -> Double? {
    guard state.stage != "arrived", state.stage != "ended" else { return nil }
    return state.etaEpoch
  }

  static func minutesLabel(
    _ state: CommuteActivityAttributes.ContentState,
    now: Double,
    t: Translate
  ) -> String? {
    guard let etaEpoch = minutesEta(state) else { return nil }
    let remaining = etaEpoch - now
    if remaining < secondsPerMinute {
      return t("commute.lock.minutes.soon", [:])
    }
    return t("commute.lock.minutes.value", ["m": String(Int((remaining / secondsPerMinute).rounded(.down)))])
  }

  /// "N분"을 보일 때만 그 끝 시각을 준다(1분 미만의 "곧"은 타이머로 바꾸지 않는다).
  static func countdownEpoch(_ state: CommuteActivityAttributes.ContentState, now: Double) -> Double? {
    guard let etaEpoch = minutesEta(state), etaEpoch - now >= secondsPerMinute else { return nil }
    return etaEpoch
  }

  static func tagOf(_ state: CommuteActivityAttributes.ContentState) -> String {
    if state.etaState == "estimated" || state.positionState != "live" {
      return "estimated"
    }
    return state.delayMinutes >= delayedMinutes ? "delayed" : "live"
  }

  static func suggestionLine(
    _ state: CommuteActivityAttributes.ContentState,
    now: Double,
    t: Translate
  ) -> String? {
    guard let suggestion = state.suggestion else { return nil }
    let minutes = max(1, Int(((suggestion.boardEtaEpoch - now) / secondsPerMinute).rounded(.down)))
    let key = suggestion.mode == "subway"
      ? "commute.lock.suggestion.subway"
      : "commute.lock.suggestion.bus"
    return t(key, [
      "line": suggestion.lineName,
      "m": String(minutes),
      "saves": String(suggestion.savesMinutes),
    ])
  }

  static func nextLegText(
    _ leg: CommuteActivityAttributes.ContentState.NextLeg,
    clock: (Double) -> String,
    t: Translate
  ) -> String {
    guard let boardEtaEpoch = leg.boardEtaEpoch else {
      return t("commute.lock.nextLeg.noEta", ["stop": leg.stopName])
    }
    let key = leg.etaState == "live"
      ? "commute.lock.nextLeg.eta"
      : "commute.lock.nextLeg.etaEstimated"
    return t(key, ["eta": clock(boardEtaEpoch), "stop": leg.stopName])
  }

  /// 옛 서버의 값에는 `nextLegs`가 없어 nil이고, TS처럼 []로 읽는다.
  static func nextLegLines(
    _ state: CommuteActivityAttributes.ContentState,
    clock: (Double) -> String,
    t: Translate
  ) -> [CommuteLockNextLeg] {
    (state.nextLegs ?? []).prefix(maxNextLegLines).map { leg in
      CommuteLockNextLeg(lineName: leg.lineName, mode: leg.mode, text: nextLegText(leg, clock: clock, t: t))
    }
  }

  static func moreLegsLine(_ state: CommuteActivityAttributes.ContentState, t: Translate) -> String? {
    let rest = (state.nextLegs ?? []).count - maxNextLegLines
    return rest >= 1 ? t("commute.lock.nextLeg.more", ["n": String(rest)]) : nil
  }
}
