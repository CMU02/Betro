package expo.modules.commutenotification

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class ContentRecord : Record {
  @Field val title: String = ""
  @Field val body: String = ""
  @Field val header: String = ""
  @Field val lines: List<String> = emptyList()
  @Field val chipText: String = ""
  @Field val countdownAtMs: Double? = null
}

class ShowRecord : Record {
  @Field val channelName: String = ""
  @Field val content: ContentRecord = ContentRecord()
  @Field val endLabel: String = ""
  @Field val seq: Double = 0.0
  @Field val sessionId: String = ""
}

/** 출퇴근 진행 중 알림. JS가 문구를 다 만들어 넘기고, 여기서는 그리기와 오래된 값 거르기만 한다. */
class CommuteNotificationModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  override fun definition() = ModuleDefinition {
    Name("CommuteNotification")

    Function("show") { input: ShowRecord ->
      CommuteNotifier.show(
        context,
        input.sessionId,
        input.seq.toLong(),
        CommuteContent(
          title = input.content.title,
          body = input.content.body,
          header = input.content.header,
          lines = input.content.lines,
          chipText = input.content.chipText,
          countdownAtMs = input.content.countdownAtMs?.toLong(),
        ),
        input.endLabel,
        input.channelName,
      )
    }

    Function("end") { sessionId: String ->
      CommuteNotifier.end(context, sessionId)
    }
  }
}
