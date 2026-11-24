package expo.modules.commutenotification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 진행 중 알림의 타이머가 끝나는 시각에 울린다(`CommuteNotifier.show`가 건다).
 * 시스템 chronometer는 0을 지나면 음수로 세므로, 다음 푸시가 오기 전까지 타이머 없이 "곧"으로 다시 그린다.
 */
class CountdownEndReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION = "expo.modules.commutenotification.COUNTDOWN_END"
    const val EXTRA_SESSION_ID = "sessionId"
    const val EXTRA_SEQ = "seq"
  }

  override fun onReceive(context: Context, intent: Intent) {
    val sessionId = intent.getStringExtra(EXTRA_SESSION_ID) ?: return
    if (!intent.hasExtra(EXTRA_SEQ)) {
      return
    }
    val seq = intent.getLongExtra(EXTRA_SEQ, 0L)
    CommuteNotifier.showAfterCountdown(context, sessionId, seq)
  }
}
