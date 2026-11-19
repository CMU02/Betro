package expo.modules.commutenotification

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/** 앱 진입 파일이 등록한 `CommuteAction` 태스크를 `{ sessionId, kind }`로 돌린다. */
class CommuteActionTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    return HeadlessJsTaskConfig(TASK_NAME, Arguments.fromBundle(extras), TIMEOUT_MS, true)
  }

  private companion object {
    const val TASK_NAME = "CommuteAction"
    const val TIMEOUT_MS = 15_000L
  }
}
