import ActivityKit
import ExpoModulesCore
import UIKit

private func hex(_ data: Data) -> String {
  data.map { String(format: "%02x", $0) }.joined()
}

/// 남은 백그라운드 실행 시간을 확보하고, 다 쓰면 놓아 준다.
@MainActor
private final class BackgroundTime {
  private var identifier = UIBackgroundTaskIdentifier.invalid

  init(name: String) {
    identifier = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
      MainActor.assumeIsolated { self?.end() }
    }
  }

  func end() {
    guard identifier != .invalid else { return }
    UIApplication.shared.endBackgroundTask(identifier)
    identifier = .invalid
  }
}

/// Live Activity 토큰을 JS 없이 서버(`PUT /v1/push-tokens`)로 보낸다.
/// 시작 푸시가 앱을 백그라운드로 깨운 몇 초 안에 업데이트 토큰을 보내야 서버가 갱신할 수 있으므로,
/// 앱 시작(`CommuteActivityAppDelegate`) 때 관찰을 시작한다.
/// 인증값(`CommuteCredentials`)이 아직 없으면 보내지 않고, 앱이 `setCredentials`로 넘긴 뒤 마지막 토큰을 보낸다.
/// 토큰과 비밀값 전체는 로그에 남기지 않는다.
@MainActor
final class CommuteTokenReporter {
  static let shared = CommuteTokenReporter()

  private struct Report {
    let kind: String
    let token: String
    let activityId: String?
    let sessionId: String?

    /// 같은 종류·Activity의 최신 토큰 하나만 둔다.
    var slot: String { "\(kind)|\(activityId ?? "")" }
  }

  private static let path = "/v1/push-tokens"
  private static let requestTimeout: TimeInterval = 10
  /// 첫 시도가 실패하면 1초, 그다음 3초 기다렸다가 다시 보낸다.
  private static let retryDelaysSeconds: [UInt64] = [1, 3]

  private var started = false
  private var watched = Set<String>()
  private var latest: [String: Report] = [:]
  /// 보낸(2xx) 것과 보내는 중인 것. 같은 (kind, activityId, token)을 같은 설치·서버로 두 번 보내지 않는다.
  private var delivered = Set<String>()
  private var inFlight = Set<String>()
  private var tasks: [Task<Void, Never>] = []

  func start() {
    guard !started else { return }
    started = true
    tasks.append(Task { [weak self] in
      for await data in Activity<CommuteActivityAttributes>.pushToStartTokenUpdates {
        self?.report(Report(kind: "apns-start", token: hex(data), activityId: nil, sessionId: nil))
      }
    })
    tasks.append(Task { [weak self] in
      for activity in Activity<CommuteActivityAttributes>.activities {
        self?.watch(activity)
      }
      for await activity in Activity<CommuteActivityAttributes>.activityUpdates {
        self?.watch(activity)
      }
    })
  }

  /// 인증값이 새로 생기거나 바뀌었을 때 마지막 토큰들을 (아직 보내지 않았으면) 보낸다.
  /// 이미 끝난 Activity의 토큰은 다시 보내지 않는다.
  func credentialsDidChange() {
    let active = Set(
      Activity<CommuteActivityAttributes>.activities
        .filter { $0.activityState == .active }
        .map(\.id)
    )
    for report in latest.values {
      if let activityId = report.activityId, !active.contains(activityId) {
        continue
      }
      send(report)
    }
  }

  private func watch(_ activity: Activity<CommuteActivityAttributes>) {
    guard watched.insert(activity.id).inserted else { return }
    let activityId = activity.id
    let sessionId = activity.attributes.sessionId
    tasks.append(Task { [weak self] in
      for await data in activity.pushTokenUpdates {
        self?.report(
          Report(kind: "apns-activity", token: hex(data), activityId: activityId, sessionId: sessionId)
        )
      }
    })
  }

  private func report(_ report: Report) {
    latest[report.slot] = report
    send(report)
  }

  private func send(_ report: Report) {
    guard let credentials = CommuteCredentials.load() else { return }
    let key = [report.kind, report.activityId ?? "", report.token, credentials.installId, credentials.serverUrl]
      .joined(separator: "|")
    guard !delivered.contains(key), !inFlight.contains(key) else { return }
    guard let request = Self.request(for: report, credentials: credentials) else { return }
    inFlight.insert(key)
    Task {
      let ok = await self.deliver(request, report: report)
      self.inFlight.remove(key)
      if ok {
        self.delivered.insert(key)
      }
    }
  }

  private func deliver(_ request: URLRequest, report: Report) async -> Bool {
    let background = BackgroundTime(name: "commute-token-report")
    defer { background.end() }
    var status = await Self.put(request)
    log(report, status: status, attempt: 1)
    for (index, delay) in Self.retryDelaysSeconds.enumerated() where !Self.isSuccess(status) {
      try? await Task.sleep(nanoseconds: delay * 1_000_000_000)
      status = await Self.put(request)
      log(report, status: status, attempt: index + 2)
    }
    return Self.isSuccess(status)
  }

  private func log(_ report: Report, status: Int, attempt: Int) {
    #if DEBUG
    print("[commute] token kind=\(report.kind) token=\(report.token.prefix(8))… status=\(status) attempt=\(attempt)")
    #endif
  }

  private static func isSuccess(_ status: Int) -> Bool {
    (200..<300).contains(status)
  }

  private static func request(for report: Report, credentials: CommuteCredentials) -> URLRequest? {
    guard let url = credentials.url(path: path) else { return nil }
    var body = ["kind": report.kind, "token": report.token, "env": apnsEnvironment]
    if let activityId = report.activityId {
      body["activityId"] = activityId
    }
    if let sessionId = report.sessionId {
      body["sessionId"] = sessionId
    }
    guard let data = try? JSONSerialization.data(withJSONObject: body) else { return nil }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "PUT"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    credentials.authorize(&request)
    request.httpBody = data
    return request
  }

  /// 응답 코드. 네트워크 오류와 타임아웃은 0.
  private nonisolated static func put(_ request: URLRequest) async -> Int {
    do {
      let (_, response) = try await URLSession.shared.data(for: request)
      return (response as? HTTPURLResponse)?.statusCode ?? 0
    } catch {
      return 0
    }
  }

  /// 빌드의 `aps-environment`가 `development`면 "sandbox", 아니면 "production".
  /// 앱스토어·TestFlight 빌드에는 프로비저닝 프로필이 없으므로 운영으로 본다.
  private static let apnsEnvironment: String = {
    #if targetEnvironment(simulator)
    return "sandbox"
    #else
    return provisionedApsEnvironment() == "development" ? "sandbox" : "production"
    #endif
  }()

  private static func provisionedApsEnvironment() -> String? {
    guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
      let data = try? Data(contentsOf: url),
      let text = String(data: data, encoding: .isoLatin1),
      let start = text.range(of: "<?xml"),
      let end = text.range(of: "</plist>", range: start.upperBound..<text.endIndex),
      let plistData = String(text[start.lowerBound..<end.upperBound]).data(using: .isoLatin1),
      let plist = try? PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any],
      let entitlements = plist["Entitlements"] as? [String: Any]
    else {
      return nil
    }
    return entitlements["aps-environment"] as? String
  }
}

public class CommuteActivityAppDelegate: BaseExpoAppDelegateSubscriber, ExpoAppDelegateSubscriberProtocol {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    MainActor.assumeIsolated {
      CommuteTokenReporter.shared.start()
    }
    return true
  }
}
