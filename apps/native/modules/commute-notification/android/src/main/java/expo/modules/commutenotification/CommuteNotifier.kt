package expo.modules.commutenotification

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat

/** JS(`notificationContent`)가 만든 글자. 문구는 모두 앱의 메시지 묶음에서 온다. */
data class CommuteContent(
  val title: String,
  val body: String,
  val header: String,
  val lines: List<String>,
  val chipText: String,
)

/**
 * 출퇴근 진행 중 알림 하나(ID 4101)를 그리고 지운다.
 * 마지막으로 그린 세션과 `seq`, 끝난 세션은 앱 전용 SharedPreferences에 두어 프로세스가 죽어도 남는다.
 */
object CommuteNotifier {
  const val NOTIFICATION_ID = 4101
  private const val CHANNEL_ID = "commute-live"
  private const val PREFS = "commute-notification"
  private const val KEY_SESSION = "sessionId"
  private const val KEY_SEQ = "seq"
  private const val KEY_ENDED = "endedSessions"
  private const val MAX_ENDED = 20
  private const val PROMOTION_API = 36
  private const val OPEN_URI = "Betro://commute"

  /** 그 세션에서 이미 그린 `seq`보다 크면 그리고 true, 아니면(옛 값, 끝난 세션) 아무것도 하지 않고 false. */
  @Synchronized
  fun show(
    context: Context,
    sessionId: String,
    seq: Long,
    content: CommuteContent,
    endLabel: String,
    channelName: String,
  ): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (endedSessions(context).contains(sessionId)) {
      return false
    }
    if (prefs.getString(KEY_SESSION, null) == sessionId && seq <= prefs.getLong(KEY_SEQ, Long.MIN_VALUE)) {
      return false
    }
    val manager = context.getSystemService(NotificationManager::class.java)
    ensureChannel(manager, channelName)
    manager.notify(NOTIFICATION_ID, build(context, sessionId, content, endLabel))
    prefs.edit().putString(KEY_SESSION, sessionId).putLong(KEY_SEQ, seq).apply()
    return true
  }

  /** 알림을 지우고 그 세션을 끝난 것으로 적는다. 그 뒤 같은 세션의 `show`는 false다. */
  @Synchronized
  fun end(context: Context, sessionId: String) {
    val ended = endedSessions(context).filter { it != sessionId }.takeLast(MAX_ENDED - 1) + sessionId
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_ENDED, ended.joinToString("\n"))
      .apply()
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (prefs.getString(KEY_SESSION, null) == sessionId) {
      context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    }
  }

  private fun endedSessions(context: Context): List<String> =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_ENDED, null)
      ?.split("\n")
      ?.filter { it.isNotEmpty() }
      ?: emptyList()

  private fun ensureChannel(manager: NotificationManager, channelName: String) {
    val existing = manager.getNotificationChannel(CHANNEL_ID)
    if (existing == null || existing.name != channelName) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, channelName, NotificationManager.IMPORTANCE_HIGH)
      )
    }
  }

  private fun expandedText(content: CommuteContent): String =
    (listOf(content.body) + content.lines).joinToString("\n")

  private fun openIntent(context: Context): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(OPEN_URI)).setPackage(context.packageName)
    return PendingIntent.getActivity(
      context,
      0,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun endIntent(context: Context, sessionId: String): PendingIntent {
    val intent = Intent(context, CommuteActionReceiver::class.java)
      .putExtra(CommuteActionReceiver.EXTRA_SESSION_ID, sessionId)
      .putExtra(CommuteActionReceiver.EXTRA_KIND, CommuteActionReceiver.KIND_END)
    return PendingIntent.getBroadcast(
      context,
      sessionId.hashCode(),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun build(
    context: Context,
    sessionId: String,
    content: CommuteContent,
    endLabel: String,
  ): Notification {
    val icon = context.applicationInfo.icon
    val expanded = expandedText(content)
    if (Build.VERSION.SDK_INT >= PROMOTION_API) {
      val builder = Notification.Builder(context, CHANNEL_ID)
        .setSmallIcon(icon)
        .setContentTitle(content.title)
        .setContentText(content.body)
        .setSubText(content.header)
        .setStyle(Notification.BigTextStyle().bigText(expanded))
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setContentIntent(openIntent(context))
        .addAction(Notification.Action.Builder(null, endLabel, endIntent(context, sessionId)).build())
      // API 36.0의 Notification.Builder에는 setRequestPromotedOngoing·setShortCriticalText가 없다(실험 5).
      // 같은 의미의 extras 키(EXTRA_REQUEST_PROMOTED_ONGOING, EXTRA_SHORT_CRITICAL_TEXT)를 직접 넣는다. 리플렉션은 R8에서 깨진다.
      builder.extras.putBoolean("android.requestPromotedOngoing", true)
      builder.extras.putString("android.shortCriticalText", content.chipText)
      return builder.build()
    }
    return NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(icon)
      .setContentTitle(content.title)
      .setContentText(content.body)
      .setSubText(content.header)
      .setStyle(NotificationCompat.BigTextStyle().bigText(expanded))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(openIntent(context))
      .addAction(0, endLabel, endIntent(context, sessionId))
      .build()
  }
}
