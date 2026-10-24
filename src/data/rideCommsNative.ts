// Lane E: ride comms. The local ride-comms module (modules/ride-comms): keeps the microphone going
// with the screen off on Android, and hears the headset's play/pause button. Null on the web and on
// builds made before it existed; ride comms then works without those two.

import { NativeModule, requireOptionalNativeModule } from 'expo';

type RideCommsEvents = { onHeadsetToggle: () => void };

declare class RideCommsModule extends NativeModule<RideCommsEvents> {
  start(title: string): void;
  stop(): void;
}

export const rideCommsNative = requireOptionalNativeModule<RideCommsModule>('RideComms');
