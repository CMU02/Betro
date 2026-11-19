package expo.modules.commutenotification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService

/** 알림의 "종료"를 받아 앱 화면을 열지 않고 헤드리스 JS 태스크(`CommuteAction`)로 넘긴다. */
class CommuteActionReceiver : BroadcastReceiver() {
  companion object {
    const val EXTRA_SESSION_ID = "sessionId"
    const val EXTRA_KIND = "kind"
    const val KIND_END = "end"
  }

  override fun onReceive(context: Context, intent: Intent) {
    val sessionId = intent.getStringExtra(EXTRA_SESSION_ID) ?: return
    val kind = intent.getStringExtra(EXTRA_KIND) ?: return
    val service = Intent(context, CommuteActionTaskService::class.java)
      .putExtra(EXTRA_SESSION_ID, sessionId)
      .putExtra(EXTRA_KIND, kind)
    try {
      if (context.startService(service) != null) {
        HeadlessJsTaskService.acquireWakeLockNow(context)
      }
    } catch (_: IllegalStateException) {
      // 백그라운드 서비스 시작이 막히면 알림을 그대로 둔다(서버에 보내지 못한 것과 같다).
    }
  }
}
