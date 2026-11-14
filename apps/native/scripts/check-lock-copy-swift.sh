#!/usr/bin/env bash
# 잠금화면 문구의 Swift 구현(CommuteCopy.swift)이 TS 모델과 같은 기대값을 내는지 맥에서 대조한다.
# - 사례: lib/commute/__fixtures__/lock-screen-cases.json
# - 문구: lib/i18n/messages-ko.ts의 commute.lock.* (bun으로 뽑는다)
# ActivityKit은 macOS에 없어서 Activity 정의 파일에서 import를 빼고 작은 대역 프로토콜을 붙여 묶는다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_DIR="${APP_DIR}/targets/commute-activity"
FIXTURE="${APP_DIR}/lib/commute/__fixtures__/lock-screen-cases.json"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lock-copy-swift.XXXXXX")"
trap 'rm -rf "${WORK_DIR}"' EXIT

for file in "${TARGET_DIR}/CommuteActivityAttributes.swift" "${TARGET_DIR}/CommuteCopy.swift"; do
  if [[ ! -f "${file}" ]]; then
    echo "missing: ${file}" >&2
    exit 1
  fi
done

grep -v '^import ActivityKit$' "${TARGET_DIR}/CommuteActivityAttributes.swift" \
  >"${WORK_DIR}/CommuteActivityAttributes.swift"
cat >"${WORK_DIR}/ActivityKitStub.swift" <<'SWIFT'
/// macOS 대조용 대역. 실제 정의는 ActivityKit에 있다.
public protocol ActivityAttributes {
  associatedtype ContentState: Codable & Hashable
}
SWIFT

(cd "${APP_DIR}" && bun -e '
import { lockStrings } from "./lib/commute/lock-strings";
console.log(JSON.stringify(lockStrings()));
') >"${WORK_DIR}/strings.json"

xcrun swiftc -swift-version 5 \
  -o "${WORK_DIR}/lock-copy-check" \
  "${WORK_DIR}/ActivityKitStub.swift" \
  "${WORK_DIR}/CommuteActivityAttributes.swift" \
  "${TARGET_DIR}/CommuteCopy.swift" \
  "${SCRIPT_DIR}/swift-copy-check/main.swift"

"${WORK_DIR}/lock-copy-check" "${WORK_DIR}/strings.json" "${FIXTURE}"
