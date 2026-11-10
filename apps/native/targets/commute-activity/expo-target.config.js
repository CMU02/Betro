/**
 * 출퇴근 Live Activity 위젯 확장. 타깃 이름은 로컬 모듈의 pod 이름(CommuteActivity)과 겹치면 안 된다.
 * 앱 그룹은 앱과 같은 것을 써서 확장이 `setPlanHeaders`로 저장한 머리줄을 읽는다.
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
	bundleIdentifier: ".commute-activity",
	deploymentTarget: "17.2",
	entitlements: {
		"com.apple.security.application-groups": ["group.com.cmu02.betro"],
	},
	frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
	name: "CommuteActivityWidget",
	type: "widget",
};
