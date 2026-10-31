// The ride replay: the ride's locked route playing itself on a 9:16 card, and the same card made
// into a short video file (an animated GIF) for the share sheet. Only the planned route, its stops
// and the ride's details go in; nobody's location is kept, so there's no track to show.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, useWindowDimensions, View } from 'react-native';
import type Svg from 'react-native-svg';
import { canMakeVideo, captureSize, framePixels, shareVideo } from '../data/replayVideo';
import { GifMaker } from '../domain/gif';
import { canReplay, FPS, frameAt, replayCaption, replayFileName, replayPlan, replayStats, wrapLines, type ReplayFrame } from '../domain/rideReplay';
import { routeOf } from '../domain/routes';
import { useClub } from '../data/ClubStore';
import type { Ride, Route } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { colors, radius, space } from '../theme';
import { Button, Notice, Row, Screen, Small, Stack } from '../ui/primitives';
import { ReplayCard, VIDEO_H, VIDEO_W, type ReplayCardProps } from '../ui/ReplayCard';

/** The screen redraws the card at most this often while playing. */
const SCREEN_FPS = 30;

const nextPaint = () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));

type Making = { state: 'idle' } | { state: 'making'; done: number } | { state: 'ready'; bytes: Uint8Array } | { state: 'error'; message: string };

export function RideReplayScreen({ route: nav }: RootScreen<'RideReplay'>) {
  const { data } = useClub();
  const ride = data.rides.find((r) => r.id === nav.params.rideId);
  const route = ride ? routeOf(ride.id, data) : undefined;
  if (!ride || !route || !canReplay(route)) {
    return (
      <Screen>
        <Notice tone="warn" title="Nothing to replay">This ride has no route with a line to play.</Notice>
      </Screen>
    );
  }
  return <Player ride={ride} route={route} />;
}

function Player({ ride, route }: { ride: Ride; route: Route }) {
  const plan = useMemo(() => replayPlan(route), [route]);
  const { width: winW, height: winH } = useWindowDimensions();
  const [ms, setMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [making, setMaking] = useState<Making>({ state: 'idle' });
  const [captureFrame, setCaptureFrame] = useState<ReplayFrame | null>(null);
  const captureRef = useRef<Svg>(null);
  const logoReady = useRef<Promise<void> | null>(null);
  const logoLoaded = useRef<() => void>(() => {});
  const stop = useRef(false);
  const drawnRef = useRef<{ frame: ReplayFrame; done: () => void } | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  // Plays on open, unless the phone asks for less motion; then it opens on the end card.
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (!live) return;
        if (reduce) setMs(plan.durationMs);
        else setPlaying(true);
      })
      .catch(() => live && setPlaying(true));
    return () => {
      live = false;
    };
  }, [plan]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = 0;
    const from = Date.now() - (ms >= plan.durationMs ? 0 : ms);
    const tick = () => {
      const now = Date.now();
      const t = now - from;
      if (t >= plan.durationMs) {
        setMs(plan.durationMs);
        setPlaying(false);
        return;
      }
      if (now - last >= 1000 / SCREEN_FPS) {
        last = now;
        setMs(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Starting from the current time only matters when play is pressed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, plan]);

  useEffect(() => () => void (stop.current = true), []);

  const caption = replayCaption(ride);
  const stats = replayStats(route);
  const cardProps: Omit<ReplayCardProps, 'frame' | 'width' | 'height'> = {
    plan,
    bounds: route.bounds,
    routeName: route.name,
    titleLines: wrapLines(caption.title, 20, 2),
    date: caption.date,
    category: caption.category,
    stats,
  };
  // As big as fits with the controls under it, never wider than the screen's column.
  const cardW = Math.max(160, Math.min(winW - space.lg * 2, 640, ((winH - 330) * VIDEO_W) / VIDEO_H));
  const cardH = (cardW * VIDEO_H) / VIDEO_W;
  const shown = frameAt(plan, ms);
  const atEnd = ms >= plan.durationMs;
  const capture = captureSize(VIDEO_W, VIDEO_H);

  const make = async () => {
    stop.current = false;
    setPlaying(false);
    setMaking({ state: 'making', done: 0 });
    logoReady.current = new Promise<void>((done) => {
      logoLoaded.current = done;
      setTimeout(done, 2000);
    });
    try {
      const grab = async (f: ReplayFrame) => {
        if (stop.current) throw new Stopped();
        // Wait until the drawing has committed this frame, then for it to reach the screen.
        const drawn = new Promise<void>((done) => (drawnRef.current = { frame: f, done }));
        setCaptureFrame(f);
        await drawn;
        await nextPaint();
        if (!captureRef.current) throw new Error('The replay closed before the video was made.');
        return framePixels(captureRef.current, VIDEO_W, VIDEO_H);
      };
      // Put the drawing up and give the logo a moment to load before the first frame.
      setCaptureFrame(frameAt(plan, plan.durationMs));
      await logoReady.current;
      // One palette for every frame, from the frames that hold all the colours.
      const samples = [await grab(frameAt(plan, plan.durationMs)), await grab(frameAt(plan, plan.introMs + 1))];
      const firstStop = plan.stops[0];
      if (firstStop) {
        const holdAt = plan.introMs + firstStop.at * (plan.durationMs - plan.introMs - plan.outroMs - plan.holdMs * plan.stops.length) + plan.holdMs / 2;
        samples.push(await grab(frameAt(plan, holdAt)));
      }
      const maker = new GifMaker(VIDEO_W, VIDEO_H, samples, 1000 / FPS);
      const count = Math.ceil((plan.durationMs * FPS) / 1000);
      for (let k = 0; k <= count; k++) {
        maker.add(await grab(frameAt(plan, (k * 1000) / FPS)));
        setMaking({ state: 'making', done: k / count });
      }
      const bytes = maker.finish();
      if (stop.current) throw new Stopped();
      setMaking({ state: 'ready', bytes });
      await share(bytes);
    } catch (e) {
      if (e instanceof Stopped) setMaking({ state: 'idle' });
      else setMaking({ state: 'error', message: (e as Error).message || 'The video couldn’t be made.' });
    } finally {
      setCaptureFrame(null);
    }
  };

  async function share(bytes: Uint8Array) {
    setShareError(null);
    try {
      await shareVideo(bytes, replayFileName(ride.title));
    } catch (e) {
      setShareError((e as Error).message);
    }
  };

  const label = `Replay of ${route.name}: ${stats.join(', ')}${route.stops.length > 0 ? `, stopping at ${plan.stops.map((s) => s.name).join(', ')}` : ''}.`;

  return (
    <Screen>
      <Stack gap={space.md} style={{ alignItems: 'center' }}>
        <View accessible accessibilityRole="image" accessibilityLabel={label} role="img" aria-label={label} style={[styles.card, { width: cardW, height: cardH }]}>
          <ReplayCard {...cardProps} frame={shown} width={cardW} height={cardH} />
        </View>
        <View style={[styles.track, { width: cardW }]} aria-hidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.fill, { width: `${Math.min(100, (ms / plan.durationMs) * 100)}%` }]} />
        </View>
      </Stack>

      <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
        <Button
          label={playing ? 'Pause' : atEnd ? 'Play again' : 'Play'}
          icon={playing ? 'pause' : atEnd ? 'refresh' : 'play'}
          kind="secondary"
          style={{ flex: 1 }}
          onPress={() => {
            if (playing) setPlaying(false);
            else {
              if (atEnd) setMs(0);
              setPlaying(true);
            }
          }}
        />
        {!atEnd || playing ? (
          <Button
            label="End card"
            icon="flag-outline"
            kind="secondary"
            style={{ flex: 1 }}
            accessibilityLabel="Skip to the end card"
            onPress={() => {
              setPlaying(false);
              setMs(plan.durationMs);
            }}
          />
        ) : null}
      </Row>

      {canMakeVideo ? (
        <Stack gap={space.sm}>
          {making.state === 'making' ? (
            <>
              <Button label={`Making the video… ${Math.round(making.done * 100)}%`} busy onPress={() => {}} />
              <Button label="Stop" kind="quiet" accessibilityLabel="Stop making the video" onPress={() => (stop.current = true)} />
            </>
          ) : making.state === 'ready' ? (
            <Button label="Share the video" icon="share-outline" onPress={() => share(making.bytes)} />
          ) : (
            <Button label="Make the video" icon="film-outline" onPress={make} />
          )}
          <View accessibilityLiveRegion="polite" role="status">
            {making.state === 'error' ? <Notice tone="danger">{making.message}</Notice> : null}
            {shareError ? <Notice tone="danger">{shareError}</Notice> : null}
            {making.state === 'making' ? <Small>{`Making the video, ${Math.floor(making.done * 10) * 10}% done.`}</Small> : null}
            {making.state === 'ready' ? <Small>The video is ready. It’s a GIF, so it plays in Messenger, WhatsApp and Facebook.</Small> : null}
          </View>
        </Stack>
      ) : (
        <Notice title="Make the video in the phone app">The web preview plays the replay. The phone app turns it into a video to share.</Notice>
      )}

      <Small>It shows the planned route and its stops. Nobody’s location is kept, so it never shows who rode where.</Small>

      {captureFrame ? (
        // The drawing the video is made from, at the video's size, off the screen.
        <View style={[styles.offscreen, capture]} aria-hidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
          <ReplayCard ref={captureRef} {...cardProps} frame={captureFrame} width={capture.width} height={capture.height} onLogoLoad={() => logoLoaded.current()} />
          <Drawn frame={captureFrame} onDrawn={(f) => {
              if (drawnRef.current?.frame === f) drawnRef.current.done();
            }} />
        </View>
      ) : null}
    </Screen>
  );
}

class Stopped extends Error {}

/** Says when a capture frame has been committed, so the picture taken is that frame's. */
function Drawn({ frame, onDrawn }: { frame: ReplayFrame; onDrawn: (f: ReplayFrame) => void }) {
  useEffect(() => {
    onDrawn(frame);
  }, [frame, onDrawn]);
  return null;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.steel, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.bone },
  offscreen: { position: 'absolute', left: -4000, top: 0 },
});
