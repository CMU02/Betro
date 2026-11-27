package expo.modules.commutenotification

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject

/** 타이머가 끝난 뒤 다시 그릴 본문과 칩(남은 분 자리에 "곧"). */
data class AfterCountdown(
  val body: String,
  val chipText: String,
)

/** JS(`notificationContent`)가 만든 글자. 문구는 모두 앱의 메시지 묶음에서 온다. */
data class CommuteContent(
  val title: String,
  val body: String,
  val header: String,
  val lines: List<String>,
  val chipText: String,
  /** 남은 시간을 거꾸로 세는 chronometer의 끝 시각(epoch 밀리초). null이면 `chipText`·본문의 글자만 쓴다. */
  val countdownAtMs: Long?,
  /** "bus" | "subway". 작은 아이콘을 고른다. */
  val mode: String,
  /** 타이머가 끝난 뒤 다시 그릴 글자. 타이머가 없으면 null. */
  val afterCountdown: AfterCountdown? = null,
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
  /** 마지막으로 그린 내용(JSON). 타이머가 끝난 뒤 `CountdownEndReceiver`가 다시 그릴 때 읽는다. */
  private const val KEY_LAST = "lastShown"
  private const val MAX_ENDED = 20
  private const val PROMOTION_API = 36
  private const val OPEN_URI = "Betro://commute"
  private const val ALARM_REQUEST_CODE = 4102

  /** 그 세션에서 이미 그린 `seq`보다 크면 그리고 true, 아니면(옛 값, 끝난 세션) 아무것도 하지 않고 false. */
  @Synchronized
  fun show(
    context: Context,
    sessionId: String,
    planId: String,
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
    manager.notify(NOTIFICATION_ID, build(context, sessionId, planId, content, endLabel))
    prefs.edit()
      .putString(KEY_SESSION, sessionId)
      .putLong(KEY_SEQ, seq)
      .putString(KEY_LAST, lastShownJson(sessionId, planId, seq, content, endLabel, channelName).toString())
      .apply()
    // 새 내용이 오면 앞 내용의 알람은 필요 없다. 이번 타이머가 있으면 그 끝 시각에 다시 건다.
    cancelCountdownEnd(context)
    val countdownAt = content.countdownAtMs
    if (countdownAt != null && content.afterCountdown != null) {
      scheduleCountdownEnd(context, sessionId, seq, countdownAt)
    }
    return true
  }

  /**
   * 타이머가 끝나면(`CountdownEndReceiver`) 타이머 없이 "곧"으로 다시 그린다. 다음 푸시가 오기 전에 0 아래로 세지 않게 한다.
   * 저장된 세션·`seq`가 알람을 건 값과 같고, 끝나지 않았고, 알림이 아직 떠 있을 때만 그린다.
   * 늦게 울린 알람이 새 내용을 덮지 않게 하려는 것이다. `seq`는 바꾸지 않는다.
   */
  @Synchronized
  fun showAfterCountdown(context: Context, sessionId: String, seq: Long) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (prefs.getString(KEY_SESSION, null) != sessionId || prefs.getLong(KEY_SEQ, Long.MIN_VALUE) != seq) {
      return
    }
    if (endedSessions(context).contains(sessionId)) {
      return
    }
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.activeNotifications.none { it.id == NOTIFICATION_ID }) {
      return
    }
    val last = prefs.getString(KEY_LAST, null)?.let { parseLastShown(it) } ?: return
    if (last.sessionId != sessionId || last.seq != seq) {
      return
    }
    val after = last.content.afterCountdown ?: return
    val content = last.content.copy(
      body = after.body,
      chipText = after.chipText,
      countdownAtMs = null,
      afterCountdown = null,
    )
    ensureChannel(manager, last.channelName)
    manager.notify(NOTIFICATION_ID, build(context, sessionId, last.planId, content, last.endLabel))
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
      // 지금 세션이 끝날 때만 지운다. 옛 세션을 끝내도 지금 세션의 알람은 남는다.
      cancelCountdownEnd(context)
    }
  }

  /**
   * 떠 있는 알림과 타이머 알람만 지운다(설정에서 잠금화면 안내를 끌 때). 서버를 기다리지 않아 연결이 없어도 지워진다.
   * `end`와 달리 세션을 끝난 것으로 적지 않고, 그린 `seq`도 잊는다. 다시 켜면 같은 세션의 다음 메시지를 그린다.
   */
  @Synchronized
  fun hideAll(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_SEQ).remove(KEY_LAST).apply()
    context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    cancelCountdownEnd(context)
  }

  /** 알람이 울릴 때 받는 `PendingIntent`. 같은 요청 코드와 Intent라 다시 걸면 바뀌고 취소도 같은 것을 찾는다. */
  private fun countdownEndIntent(context: Context, sessionId: String?, seq: Long?): PendingIntent {
    val intent = Intent(context, CountdownEndReceiver::class.java).setAction(CountdownEndReceiver.ACTION)
    if (sessionId != null && seq != null) {
      intent.putExtra(CountdownEndReceiver.EXTRA_SESSION_ID, sessionId)
        .putExtra(CountdownEndReceiver.EXTRA_SEQ, seq)
    }
    return PendingIntent.getBroadcast(
      context,
      ALARM_REQUEST_CODE,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  /**
   * 정확한 알람 권한이 필요 없고 Doze에서도 울리지만 늦을 수 있다.
   * `RTC`라 화면이 꺼진 동안에는 켤 때 울린다(기기 확인은 Task 13).
   */
  private fun scheduleCountdownEnd(context: Context, sessionId: String, seq: Long, atMs: Long) {
    val alarms = context.getSystemService(AlarmManager::class.java) ?: return
    alarms.setAndAllowWhileIdle(AlarmManager.RTC, atMs, countdownEndIntent(context, sessionId, seq))
  }

  private fun cancelCountdownEnd(context: Context) {
    val alarms = context.getSystemService(AlarmManager::class.java) ?: return
    val pending = countdownEndIntent(context, null, null)
    alarms.cancel(pending)
    pending.cancel()
  }

  private class LastShown(
    val sessionId: String,
    val planId: String,
    val seq: Long,
    val content: CommuteContent,
    val endLabel: String,
    val channelName: String,
  )

  private fun lastShownJson(
    sessionId: String,
    planId: String,
    seq: Long,
    content: CommuteContent,
    endLabel: String,
    channelName: String,
  ): JSONObject {
    val json = JSONObject()
      .put("sessionId", sessionId)
      .put("planId", planId)
      .put("seq", seq)
      .put("endLabel", endLabel)
      .put("channelName", channelName)
      .put("title", content.title)
      .put("body", content.body)
      .put("header", content.header)
      .put("lines", JSONArray(content.lines))
      .put("chipText", content.chipText)
      .put("mode", content.mode)
    content.countdownAtMs?.let { json.put("countdownAtMs", it) }
    content.afterCountdown?.let {
      json.put("afterCountdown", JSONObject().put("body", it.body).put("chipText", it.chipText))
    }
    return json
  }

  /** 저장 모양이 맞지 않으면 null(다시 그리지 않는다). */
  private fun parseLastShown(text: String): LastShown? =
    try {
      val json = JSONObject(text)
      val lines = json.getJSONArray("lines")
      val after = json.optJSONObject("afterCountdown")
      LastShown(
        sessionId = json.getString("sessionId"),
        planId = json.getString("planId"),
        seq = json.getLong("seq"),
        endLabel = json.getString("endLabel"),
        channelName = json.getString("channelName"),
        content = CommuteContent(
          title = json.getString("title"),
          body = json.getString("body"),
          header = json.getString("header"),
          lines = (0 until lines.length()).map { lines.getString(it) },
          chipText = json.getString("chipText"),
          countdownAtMs = if (json.has("countdownAtMs")) json.getLong("countdownAtMs") else null,
          mode = json.getString("mode"),
          afterCountdown = after?.let {
            AfterCountdown(body = it.getString("body"), chipText = it.getString("chipText"))
          },
        ),
      )
    } catch (_: org.json.JSONException) {
      null
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

  /** 누르면 그 장소의 17 출퇴근 안내를 연다(TS `guideLink`와 같은 모양). */
  private fun openIntent(context: Context, planId: String): PendingIntent {
    val uri = Uri.parse(OPEN_URI).buildUpon().appendQueryParameter("plan", planId).build()
    val intent = Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName)
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
    planId: String,
    content: CommuteContent,
    endLabel: String,
  ): Notification {
    // 앱 아이콘은 단색으로 바뀌면 동그라미 하나가 되어, 수단 아이콘(iOS 아일랜드 Minimal과 같은 그림)을 쓴다.
    val icon = if (content.mode == "subway") R.drawable.commute_train else R.drawable.commute_bus
    val expanded = expandedText(content)
    val countdownAt = content.countdownAtMs
    if (Build.VERSION.SDK_INT >= PROMOTION_API) {
      val builder = Notification.Builder(context, CHANNEL_ID)
        .setSmallIcon(icon)
        .setContentTitle(content.title)
        .setContentText(content.body)
        .setSubText(content.header)
        .setStyle(Notification.BigTextStyle().bigText(expanded))
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(openIntent(context, planId))
        .addAction(Notification.Action.Builder(null, endLabel, endIntent(context, sessionId)).build())
      if (countdownAt != null) {
        builder.setWhen(countdownAt)
          .setShowWhen(true)
          .setUsesChronometer(true)
          .setChronometerCountDown(true)
      } else {
        builder.setShowWhen(false)
      }
      // API 36.0의 Notification.Builder에는 setRequestPromotedOngoing·setShortCriticalText가 없다(실험 5).
      // 같은 의미의 extras 키(EXTRA_REQUEST_PROMOTED_ONGOING, EXTRA_SHORT_CRITICAL_TEXT)를 직접 넣는다. 리플렉션은 R8에서 깨진다.
      builder.extras.putBoolean("android.requestPromotedOngoing", true)
      // 타이머가 있으면 칩이 `when`의 chronometer를 센다. 칩 글자를 함께 두면 글자가 앞설 수 있어 넣지 않는다.
      if (countdownAt == null) {
        builder.extras.putString("android.shortCriticalText", content.chipText)
      }
      return builder.build()
    }
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(icon)
      .setContentTitle(content.title)
      .setContentText(content.body)
      .setSubText(content.header)
      .setStyle(NotificationCompat.BigTextStyle().bigText(expanded))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(openIntent(context, planId))
      .addAction(0, endLabel, endIntent(context, sessionId))
    if (countdownAt != null) {
      builder.setWhen(countdownAt)
        .setShowWhen(true)
        .setUsesChronometer(true)
        .setChronometerCountDown(true)
    } else {
      builder.setShowWhen(false)
    }
    return builder.build()
  }
}
