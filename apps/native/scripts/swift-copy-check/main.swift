import Foundation

// 잠금화면 문구 대조: CommuteCopy.model이 lock-screen-cases.json의 expected와 글자 그대로 같은지 본다.
// 쓰임: lock-copy-check <strings.json> <lock-screen-cases.json>
// strings.json은 messages-ko.ts의 commute.lock.*를 펼친 사전이다(check-lock-copy-swift.sh가 만든다).

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("error: \(message)\n".utf8))
  exit(1)
}

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
  fail("usage: lock-copy-check <strings.json> <lock-screen-cases.json>")
}

func readJSON(_ path: String) -> Any {
  guard let data = FileManager.default.contents(atPath: path) else {
    fail("cannot read \(path)")
  }
  do {
    return try JSONSerialization.jsonObject(with: data)
  } catch {
    fail("cannot parse \(path): \(error)")
  }
}

guard let strings = readJSON(arguments[1]) as? [String: String], !strings.isEmpty else {
  fail("strings.json is not a non-empty string dictionary")
}

let placeholder = try! NSRegularExpression(pattern: "\\{(\\w+)\\}")

/// TS `translate`와 같이 없는 키나 채우지 못한 자리표시자는 바로 실패한다.
func translate(_ key: String, _ params: [String: String]) -> String {
  guard var text = strings[key] else {
    fail("unknown message key \(key)")
  }
  for (name, value) in params {
    text = text.replacingOccurrences(of: "{\(name)}", with: value)
  }
  let range = NSRange(text.startIndex..., in: text)
  if placeholder.firstMatch(in: text, range: range) != nil {
    fail("unfilled placeholder in \(key): \(text)")
  }
  return text
}

guard
  let fixture = readJSON(arguments[2]) as? [String: Any],
  let timezoneId = fixture["timezone"] as? String,
  let timeZone = TimeZone(identifier: timezoneId),
  let cases = fixture["cases"] as? [[String: Any]]
else {
  fail("fixture must have timezone and cases")
}
guard !cases.isEmpty else {
  fail("fixture has no cases")
}

/// TS 테스트의 FORBIDDEN_TEXT에 Swift 옵셔널이 새어 나온 모양을 더했다.
let forbidden = try! NSRegularExpression(pattern: "\\bnull\\b|\\bnil\\b|Optional\\(|undefined|NaN|1970")

func describe(_ value: String?) -> String {
  value.map { "\"\($0)\"" } ?? "null"
}

var matched = 0
var mismatches: [String] = []

for item in cases {
  let name = item["name"] as? String ?? "(unnamed)"
  guard
    let now = item["now"] as? Double,
    let stateObject = item["state"],
    let expected = item["expected"] as? [String: Any]
  else {
    fail("case \(name) is missing now, state or expected")
  }
  let state: CommuteActivityAttributes.ContentState
  do {
    let data = try JSONSerialization.data(withJSONObject: stateObject)
    state = try JSONDecoder().decode(CommuteActivityAttributes.ContentState.self, from: data)
  } catch {
    fail("case \(name): cannot decode state: \(error)")
  }
  let header = item["header"] as? String
  let model = CommuteCopy.model(
    state: state,
    now: Date(timeIntervalSince1970: now),
    header: header,
    timeZone: timeZone,
    t: translate
  )

  var problems: [String] = []
  func check(_ field: String, _ actual: String?, _ wanted: Any?) {
    let wantedText = wanted as? String
    if actual != wantedText {
      problems.append("\(field): got \(describe(actual)), want \(describe(wantedText))")
    }
  }
  check("status", model.status, expected["status"])
  check("detail", model.detail, expected["detail"])
  check("minutes", model.minutes, expected["minutes"])
  check("tag", model.tag, expected["tag"])
  check("suggestion", model.suggestion, expected["suggestion"])
  check("moreLegs", model.moreLegs, expected["moreLegs"])
  check("header", model.header, header ?? strings["commute.lock.header.fallback"])

  let wantedLegs = expected["nextLegs"] as? [[String: String]] ?? []
  if wantedLegs.count != model.nextLegs.count {
    problems.append("nextLegs: got \(model.nextLegs.count) rows, want \(wantedLegs.count)")
  }
  for (index, pair) in zip(model.nextLegs, wantedLegs).enumerated() {
    check("nextLegs[\(index)].lineName", pair.0.lineName, pair.1["lineName"])
    check("nextLegs[\(index)].mode", pair.0.mode, pair.1["mode"])
    check("nextLegs[\(index)].text", pair.0.text, pair.1["text"])
  }

  var texts = [model.status, model.detail, model.header, model.lineName, model.mode, model.tag, model.tagLabel]
  texts += [model.minutes, model.suggestion, model.moreLegs].compactMap { $0 }
  texts += model.nextLegs.flatMap { [$0.lineName, $0.mode, $0.text] }
  for text in texts where forbidden.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil {
    problems.append("forbidden text: \(text)")
  }

  if problems.isEmpty {
    matched += 1
    print("ok    \(name)")
  } else {
    print("FAIL  \(name)")
    for problem in problems {
      print("        \(problem)")
    }
    mismatches.append(name)
  }
}

print("matched \(matched)/\(cases.count) cases")
if !mismatches.isEmpty {
  exit(1)
}
