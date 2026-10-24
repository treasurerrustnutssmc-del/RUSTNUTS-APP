import ExpoModulesCore
import MediaPlayer

// The headset's play/pause button reaches the app as a remote command while it's the "now playing"
// app; ride comms turns that into mute. The call itself keeps running in the background through the
// app's `audio` background mode.
public class RideCommsModule: Module {
  private var targets: [(MPRemoteCommand, Any)] = []

  public func definition() -> ModuleDefinition {
    Name("RideComms")

    Events("onHeadsetToggle")

    Function("start") { (title: String) in
      DispatchQueue.main.async { self.register(title: title) }
    }

    Function("stop") {
      DispatchQueue.main.async { self.unregister() }
    }

    OnDestroy {
      DispatchQueue.main.async { self.unregister() }
    }
  }

  private func register(title: String) {
    unregister()
    let center = MPRemoteCommandCenter.shared()
    for command in [center.togglePlayPauseCommand, center.playCommand, center.pauseCommand] {
      command.isEnabled = true
      let target = command.addTarget { [weak self] _ in
        self?.sendEvent("onHeadsetToggle", [:])
        return .success
      }
      targets.append((command, target))
    }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = [MPMediaItemPropertyTitle: title]
  }

  private func unregister() {
    for (command, target) in targets {
      command.removeTarget(target)
    }
    targets.removeAll()
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
  }
}
