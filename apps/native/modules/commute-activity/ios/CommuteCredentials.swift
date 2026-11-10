import Foundation
import Security

/// 네이티브 코드(토큰 보고, 잠금화면 버튼)가 JS 없이 서버에 인증할 때 쓰는 값.
/// 앱이 `setCredentials`로 넘기고, 모듈 전용 키체인 항목에 JSON으로 둔다.
/// `AfterFirstUnlock`이라 기기를 켠 뒤 한 번 잠금을 풀면 잠긴 상태의 백그라운드 실행에서도 읽힌다.
struct CommuteCredentials: Codable, Equatable {
  var installId: String
  var secret: String
  var serverUrl: String

  private static let service = "com.cmu02.betro.commute"
  private static let account = "credentials"

  private static var baseQuery: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  /// 항목이 없거나, 아직 한 번도 잠금을 풀지 않아 읽을 수 없거나, 값이 깨졌으면 nil.
  static func load() -> CommuteCredentials? {
    var query = baseQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else {
      return nil
    }
    return try? JSONDecoder().decode(CommuteCredentials.self, from: data)
  }

  /// 지우고 다시 쓴다. 접근 속성은 쓸 때만 정해지므로 갱신 대신 새로 넣는다.
  static func save(_ credentials: CommuteCredentials) throws {
    let data = try JSONEncoder().encode(credentials)
    SecItemDelete(baseQuery as CFDictionary)
    var attributes = baseQuery
    attributes[kSecValueData as String] = data
    attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    let status = SecItemAdd(attributes as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw CommuteCredentialsError.keychain(status)
    }
  }

  /// 서버 주소에 경로를 붙인다. 주소 끝의 `/`와 경로 앞의 `/`가 겹쳐도 하나만 남는다.
  func url(path: String) -> URL? {
    var base = serverUrl
    while base.hasSuffix("/") {
      base.removeLast()
    }
    var tail = Substring(path)
    while tail.hasPrefix("/") {
      tail = tail.dropFirst()
    }
    return URL(string: "\(base)/\(tail)")
  }

  /// Task 1의 서버 클라이언트와 같은 인증 헤더.
  func authorize(_ request: inout URLRequest) {
    request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
    request.setValue(installId, forHTTPHeaderField: "X-Betro-Install")
  }
}

enum CommuteCredentialsError: Error {
  case keychain(OSStatus)
}
