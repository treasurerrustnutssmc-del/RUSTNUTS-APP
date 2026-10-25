package expo.modules.ridecomms

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RideCommsModule : Module() {
  private val onToggle: () -> Unit = { sendEvent("onHeadsetToggle", emptyMap<String, Any>()) }

  override fun definition() = ModuleDefinition {
    Name("RideComms")

    Events("onHeadsetToggle")

    OnCreate {
      RideCommsService.onHeadsetToggle = onToggle
    }

    OnDestroy {
      // A reload makes a new module before this one goes; only clear what's still ours.
      if (RideCommsService.onHeadsetToggle === onToggle) RideCommsService.onHeadsetToggle = null
      appContext.reactContext?.let { it.stopService(Intent(it, RideCommsService::class.java)) }
    }

    // Called once the microphone is allowed and while the app is on screen: Android 14 only lets
    // a microphone service start then. Returns false when Android refused it.
    Function("start") { title: String ->
      val context = appContext.reactContext ?: return@Function false
      // Without the microphone allowed, Android would stop the app for starting this service.
      if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return@Function false
      val intent = Intent(context, RideCommsService::class.java).putExtra(RideCommsService.EXTRA_TITLE, title)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
        true
      } catch (e: Exception) {
        false
      }
    }

    Function("stop") {
      val context = appContext.reactContext ?: return@Function null
      context.stopService(Intent(context, RideCommsService::class.java))
      null
    }
  }
}
