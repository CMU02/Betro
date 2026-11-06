package expo.modules.systembars

import android.os.Build
import android.view.Window
import android.view.WindowInsetsController
import androidx.core.view.WindowInsetsControllerCompat
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val LIGHT_BARS_MASK =
  WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS

/**
 * 상태 표시줄 아이콘과 내비게이션 바 버튼 색을 함께 정한다. `lightContent`면 밝은 아이콘·버튼.
 *
 * Android 11~14에서 `Window`로 만든 androidx `WindowInsetsControllerCompat`는 레거시
 * `systemUiVisibility` 플래그만 바꾼다. 프로세스 안의 무엇이든 `setSystemBarsAppearance`를 한 번
 * 부르면 창에 `APPEARANCE_CONTROLLED`가 켜지고, 그 뒤로 레거시 플래그는 무시된다. Galaxy S20 Ultra
 * (Android 13)에서는 앱이 백그라운드에서 돌아올 때마다 이렇게 되어 바 색이 그 순간 값에 고정됐다.
 * 그래서 API 30 이상에서는 플랫폼 컨트롤러를 직접 부르고, 아직 켜지지 않은 경우를 위해 레거시 플래그도
 * 같은 값으로 맞춘다.
 */
internal fun Window.setBarsContent(lightContent: Boolean) {
  WindowInsetsControllerCompat(this, decorView).run {
    isAppearanceLightStatusBars = !lightContent
    isAppearanceLightNavigationBars = !lightContent
  }

  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
    insetsController?.setSystemBarsAppearance(
      if (lightContent) 0 else LIGHT_BARS_MASK,
      LIGHT_BARS_MASK,
    )
  }
}

class SystemBarsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SystemBars")

    AsyncFunction("setContentStyle") { lightContent: Boolean ->
      appContext.currentActivity?.window?.setBarsContent(lightContent)
      return@AsyncFunction
    }.runOnQueue(Queues.MAIN)
  }
}
