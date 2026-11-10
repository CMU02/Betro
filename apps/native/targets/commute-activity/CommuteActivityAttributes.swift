import ActivityKit
import Foundation

/// 앱(로컬 모듈)과 위젯 확장이 함께 쓰는 Live Activity 정의.
/// push-to-start의 `attributes-type`은 이 타입 이름(`CommuteActivityAttributes`)과 같아야 한다.
/// 원본은 이 파일 하나이고, `modules/commute-activity/ios`에는 심볼릭 링크로 들어간다.
public struct CommuteActivityAttributes: ActivityAttributes {
  /// 서버가 보내는 출퇴근 푸시 값 v1(`apps/native/lib/commute/content-state.ts`와 같은 필드).
  /// 시각은 epoch 초다. null일 수 있는 필드는 옵셔널이라 키가 없어도 디코딩된다.
  /// 모르는 키는 합성된 `Decodable`이 무시하므로 서버가 필드를 더해도 옛 앱이 동작한다.
  public struct ContentState: Codable, Hashable {
    public struct Passed: Codable, Hashable {
      public var lineName: String

      public init(lineName: String) {
        self.lineName = lineName
      }
    }

    public struct Suggestion: Codable, Hashable {
      public var rank: Int
      public var lineName: String
      public var boardEtaEpoch: Double
      public var savesMinutes: Int

      public init(rank: Int, lineName: String, boardEtaEpoch: Double, savesMinutes: Int) {
        self.rank = rank
        self.lineName = lineName
        self.boardEtaEpoch = boardEtaEpoch
        self.savesMinutes = savesMinutes
      }
    }

    public var v: Int
    public var seq: Int
    public var sentAt: Double
    /// "walk" | "wait" | "ride" | "arrived" | "ended"
    public var stage: String
    public var legIndex: Int
    public var legCount: Int
    /// "bus" | "subway"
    public var mode: String
    public var lineName: String
    public var stopName: String
    public var stopsAway: Int?
    public var etaEpoch: Double?
    public var leaveEpoch: Double?
    public var passed: Passed?
    /// "live" | "stale" | "none"
    public var positionState: String
    /// "live" | "estimated"
    public var etaState: String
    public var delayMinutes: Int
    public var destinationEtaEpoch: Double?
    public var suggestion: Suggestion?

    public init(
      v: Int,
      seq: Int,
      sentAt: Double,
      stage: String,
      legIndex: Int,
      legCount: Int,
      mode: String,
      lineName: String,
      stopName: String,
      stopsAway: Int?,
      etaEpoch: Double?,
      leaveEpoch: Double?,
      passed: Passed?,
      positionState: String,
      etaState: String,
      delayMinutes: Int,
      destinationEtaEpoch: Double?,
      suggestion: Suggestion?
    ) {
      self.v = v
      self.seq = seq
      self.sentAt = sentAt
      self.stage = stage
      self.legIndex = legIndex
      self.legCount = legCount
      self.mode = mode
      self.lineName = lineName
      self.stopName = stopName
      self.stopsAway = stopsAway
      self.etaEpoch = etaEpoch
      self.leaveEpoch = leaveEpoch
      self.passed = passed
      self.positionState = positionState
      self.etaState = etaState
      self.delayMinutes = delayMinutes
      self.destinationEtaEpoch = destinationEtaEpoch
      self.suggestion = suggestion
    }
  }

  public var planId: String
  public var sessionId: String

  public init(planId: String, sessionId: String) {
    self.planId = planId
    self.sessionId = sessionId
  }
}

/// 앱과 확장이 함께 쓰는 앱 그룹 저장소의 이름.
public enum CommuteSharedStore {
  public static let appGroup = "group.com.cmu02.betro"
  /// `planId` → 머리줄(예: "출근 · 회사까지") 사전. 앱이 쓰고 확장이 읽는다.
  public static let planHeadersKey = "commute.planHeaders"

  public static func planHeader(planId: String) -> String? {
    let headers = UserDefaults(suiteName: appGroup)?.dictionary(forKey: planHeadersKey)
    return headers?[planId] as? String
  }
}
