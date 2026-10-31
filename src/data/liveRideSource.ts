// Which live ride source the app uses: the club database in a live build, the demo's made-up
// riders otherwise. The demo reads the demo club through whatever the demo provider binds here.

import type { ClubData, Member } from '../domain/types';
import { liveDataOn } from './reviewMode';
import type { LiveRideBackend } from './liveRideBackend';
import { liveRideApi } from './liveRideApi';
import { createDemoLiveBackend } from './liveRideDemo';

type DemoView = () => { data: ClubData; me: Member | null };

let demoView: DemoView = () => ({ data: { chapters: [], members: [], privates: [], bikes: [], registrations: [], emergencyContacts: [], positions: [], rides: [], rsvps: [] }, me: null });
let demo: LiveRideBackend | null = null;

/** Called by the demo provider, so the demo's live ride sees the demo club as it is now. */
export function bindDemoLive(view: DemoView): void {
  demoView = view;
}

export function liveBackend(): LiveRideBackend {
  if (liveDataOn()) return liveRideApi;
  demo ??= createDemoLiveBackend(() => demoView());
  return demo;
}
