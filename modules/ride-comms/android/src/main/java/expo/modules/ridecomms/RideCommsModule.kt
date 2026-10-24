package expo.modules.ridecomms

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RideCommsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RideComms")

    Events("onHeadsetToggle")

    OnCreate {
      RideCommsService.onHeadsetToggle = { sendEvent("onHeadsetToggle", emptyMap<String, Any>()) }
    }

    OnDestroy {
      RideCommsService.onHeadsetToggle = null
    }

    Function("start") { title: String ->
      val context = appContext.reactContext ?: return@Function
      val intent = Intent(context, RideCommsService::class.java).putExtra(RideCommsService.EXTRA_TITLE, title)
      // Started after the microphone is on: Android 14 refuses a microphone service without it.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
    }

    Function("stop") {
      val context = appContext.reactContext ?: return@Function
      context.stopService(Intent(context, RideCommsService::class.java))
    }
  }
}
