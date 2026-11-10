import ActivityKit
import ExpoModulesCore

struct CredentialsRecord: Record {
  @Field var installId: String = ""
  @Field var secret: String = ""
  @Field var serverUrl: String = ""
}

struct ActivityAttributesRecord: Record {
  @Field var planId: String = ""
  @Field var sessionId: String = ""
}

final class InvalidContentStateException: Exception, @unchecked Sendable {
  override var reason: String {
    "The content state does not match push value v1"
  }
}

public class CommuteActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CommuteActivity")

    /// 키체인 값이 같으면 다시 쓰지 않는다. 어느 쪽이든 아직 보내지 못한 토큰을 보낸다.
    AsyncFunction("setCredentials") { (input: CredentialsRecord) async throws in
      let credentials = CommuteCredentials(
        installId: input.installId,
        secret: input.secret,
        serverUrl: input.serverUrl
      )
      if CommuteCredentials.load() != credentials {
        try CommuteCredentials.save(credentials)
      }
      await MainActor.run {
        CommuteTokenReporter.shared.credentialsDidChange()
      }
    }

    AsyncFunction("setPlanHeaders") { (headers: [String: String]) in
      UserDefaults(suiteName: CommuteSharedStore.appGroup)?
        .set(headers, forKey: CommuteSharedStore.planHeadersKey)
    }

    Function("areActivitiesEnabled") { () -> Bool in
      ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// 표본 화면 확인용. 시작 푸시와 같은 디코딩 경로(JSON → `ContentState`)를 쓴다.
    AsyncFunction("startLocal") { (attributes: ActivityAttributesRecord, state: [String: Any]) throws -> String in
      guard JSONSerialization.isValidJSONObject(state) else {
        throw InvalidContentStateException()
      }
      let content: CommuteActivityAttributes.ContentState
      do {
        let data = try JSONSerialization.data(withJSONObject: state)
        content = try JSONDecoder().decode(CommuteActivityAttributes.ContentState.self, from: data)
      } catch {
        throw InvalidContentStateException()
      }
      let activity = try Activity<CommuteActivityAttributes>.request(
        attributes: CommuteActivityAttributes(planId: attributes.planId, sessionId: attributes.sessionId),
        content: .init(state: content, staleDate: nil),
        pushType: .token
      )
      return activity.id
    }

    AsyncFunction("endAll") { () async in
      for activity in Activity<CommuteActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}
