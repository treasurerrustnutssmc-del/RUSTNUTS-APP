package expo.modules.ridecomms

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import android.view.KeyEvent

// Keeps the microphone allowed while the screen is off (Android stops background microphone use
// without a foreground service of type microphone), and listens for the headset's play/pause button.
class RideCommsService : Service() {
  companion object {
    const val EXTRA_TITLE = "title"
    private const val CHANNEL_ID = "ride-comms"
    private const val NOTIFICATION_ID = 7319
    var onHeadsetToggle: (() -> Unit)? = null
  }

  private var session: MediaSession? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Ride comms is on"
    val notification = buildNotification(title)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      // Android refused (the app went to the background first): the call carries on without it.
      stopSelf()
      return START_NOT_STICKY
    }
    startSession()
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    session?.release()
    session = null
    super.onDestroy()
  }

  private fun buildNotification(title: String): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Ride comms", NotificationManager.IMPORTANCE_LOW))
    }
    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
    builder
      .setContentTitle(title)
      .setContentText("Tap to open.")
      .setSmallIcon(smallIcon())
      .setOngoing(true)
    packageManager.getLaunchIntentForPackage(packageName)?.let { open ->
      open.flags = open.flags or Intent.FLAG_ACTIVITY_SINGLE_TOP
      builder.setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
    return builder.build()
  }

  // The monochrome notification icon expo-notifications makes, else the app's icon.
  private fun smallIcon(): Int {
    val id = resources.getIdentifier("notification_icon", "drawable", packageName)
    return if (id != 0) id else applicationInfo.icon
  }

  // A playing media session is where Android sends a headset's play/pause press.
  private fun startSession() {
    if (session != null) return
    session = MediaSession(this, "RideComms").apply {
      setCallback(object : MediaSession.Callback() {
        override fun onMediaButtonEvent(mediaButtonIntent: Intent): Boolean {
          val event = (
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
              mediaButtonIntent.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
            } else {
              @Suppress("DEPRECATION")
              mediaButtonIntent.getParcelableExtra(Intent.EXTRA_KEY_EVENT)
            }
          ) ?: return false
          if (event.action != KeyEvent.ACTION_UP) return true
          when (event.keyCode) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK,
            KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> {
              onHeadsetToggle?.invoke()
              return true
            }
          }
          return false
        }
      })
      setPlaybackState(
        PlaybackState.Builder()
          .setActions(PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE)
          .setState(PlaybackState.STATE_PLAYING, 0, 1f)
          .build(),
      )
      isActive = true
    }
  }
}
