// A photo you can pinch to zoom, drag about once zoomed, and double-tap in or out (Jeff, 28 Nov 2026).
// Built on React Native's own touch handling, so it ships in an app update with no new app build. The
// sums are in src/domain/zoom.ts.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, View, type GestureResponderEvent } from 'react-native';
import { clampView, doubleTap, pinchTo, type View as Zoom } from '../domain/zoom';

const ONE: Zoom = { scale: 1, x: 0, y: 0 };
const TAP_MS = 250;
const TAP_SLOP = 10;

type Pt = { x: number; y: number };

/** The touch handling for one photo: plain closures, so nothing is read from React while it draws. */
function makeZoom(width: number, height: number, onZoomed: (zoomed: boolean) => void) {
  const box = { width, height };
  const anim = { scale: new Animated.Value(1), x: new Animated.Value(0), y: new Animated.Value(0) };
  let view: Zoom = ONE;
  let zoomed = false;
  let held = false; // told to the viewer: zoomed, or two fingers down
  const at = { left: 0, top: 0 }; // the box's top on screen, for touches measured from the screen
  const g = { start: ONE, from: { x: 0, y: 0 } as Pt, dist: 1, fingers: 0, downAt: 0, moved: false, lastTap: 0 };

  const show = (v: Zoom, animated = false) => {
    view = v;
    if (animated) {
      Animated.parallel([
        Animated.timing(anim.scale, { toValue: v.scale, duration: 180, useNativeDriver: false }),
        Animated.timing(anim.x, { toValue: v.x, duration: 180, useNativeDriver: false }),
        Animated.timing(anim.y, { toValue: v.y, duration: 180, useNativeDriver: false }),
      ]).start();
    } else {
      anim.scale.setValue(v.scale);
      anim.x.setValue(v.x);
      anim.y.setValue(v.y);
    }
    zoomed = v.scale > 1.01;
    hold(zoomed || g.fingers >= 2);
  };
  // Swiping to the next photo pauses while zoomed, and as soon as a second finger lands for a pinch.
  const hold = (h: boolean) => {
    if (h === held) return;
    held = h;
    onZoomed(h);
  };

  // Touches from the middle of the box.
  const point = (t: { pageX: number; pageY: number }): Pt => ({ x: t.pageX - at.left - width / 2, y: t.pageY - at.top - height / 2 });
  const touches = (e: GestureResponderEvent): Pt[] => e.nativeEvent.touches.map(point);
  const mid = (t: Pt[]): Pt => ({ x: (t[0].x + t[1].x) / 2, y: (t[0].y + t[1].y) / 2 });
  const apart = (t: Pt[]) => Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y) || 1;

  // A gesture's starting point, taken again whenever a finger lands or lifts.
  const baseline = (t: Pt[]) => {
    g.start = view;
    g.fingers = t.length;
    if (t.length >= 2) hold(true);
    if (t.length >= 2) {
      g.from = mid(t);
      g.dist = apart(t);
    } else if (t.length === 1) {
      g.from = t[0];
    }
  };

  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length >= 2 || zoomed,
    // A swipe on a whole photo belongs to the row of photos; a zoomed one or a pinch stays here.
    onPanResponderTerminationRequest: () => !zoomed && g.fingers < 2,
    onShouldBlockNativeResponder: () => zoomed || g.fingers >= 2,
    onPanResponderGrant: (e) => {
      // A touch during the zoom-in/out animation starts from where the picture is drawn now.
      anim.scale.stopAnimation((scale) => { view = { ...view, scale }; });
      anim.x.stopAnimation((x) => { view = { ...view, x }; });
      anim.y.stopAnimation((y) => { view = { ...view, y }; });
      g.downAt = Date.now();
      g.moved = false;
      baseline(touches(e));
    },
    onPanResponderMove: (e) => {
      const t = touches(e);
      if (!t.length) return;
      if (t.length !== g.fingers) baseline(t);
      if (t.length >= 2) {
        g.moved = true;
        show(pinchTo(g.start, g.from, mid(t), apart(t) / g.dist, box));
        return;
      }
      const dx = t[0].x - g.from.x;
      const dy = t[0].y - g.from.y;
      if (Math.hypot(dx, dy) > TAP_SLOP) g.moved = true;
      if (view.scale > 1.01) show(clampView({ ...g.start, x: g.start.x + dx, y: g.start.y + dy }, box));
    },
    onPanResponderRelease: (e) => {
      const now = Date.now();
      const quick = !g.moved && now - g.downAt < TAP_MS;
      if (quick && now - g.lastTap < 300) {
        g.lastTap = 0;
        show(doubleTap(view, point(e.nativeEvent.changedTouches[0]), box), true);
      } else {
        g.lastTap = quick ? now : 0;
        g.fingers = 0;
        if (view.scale < 1.05) show(ONE, true);
      }
      g.fingers = 0;
      hold(zoomed);
    },
    onPanResponderTerminate: () => {
      g.fingers = 0;
      if (view.scale < 1.05) show(ONE, true);
      else hold(zoomed);
    },
  });

  return { anim, responder, place: (x: number, y: number) => { at.left = x; at.top = y; } };
}

export function ZoomablePhoto({ width, height, onZoomed, children, accessibilityLabel }: {
  width: number;
  height: number;
  /** Told when the photo goes from whole to zoomed and back, so swiping between photos can pause. */
  onZoomed: (zoomed: boolean) => void;
  children: React.ReactNode;
  accessibilityLabel?: string;
}) {
  // The web needs to know too: whole, the browser may pan the row of photos; held, nothing of its own.
  const [held, setHeld] = useState(false);
  const report = useCallback((h: boolean) => {
    setHeld(h);
    onZoomed(h);
  }, [onZoomed]);
  // Pass onZoomed that keeps its identity (a state setter), or each new one starts the photo afresh.
  const zoom = useMemo(() => makeZoom(width, height, report), [width, height, report]);
  // A photo that goes (taken down, or drawn afresh at a new size) never leaves swiping paused.
  useEffect(() => () => report(false), [zoom, report]);
  const host = useRef<React.ComponentRef<typeof View>>(null);
  return (
    <View
      ref={host}
      // On the web the browser would otherwise zoom the whole page.
      style={{ width, height, overflow: 'hidden', touchAction: held ? 'none' : 'pan-x' } as never}
      // Only the top is kept: a page of the row is measured wherever it sat then, but the one being touched
      // is always the one on screen, from the left edge.
      onLayout={() => host.current?.measureInWindow((_x: number, y: number) => zoom.place(0, y))}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      {...zoom.responder.panHandlers}
    >
      <Animated.View style={{ width, height, transform: [{ translateX: zoom.anim.x }, { translateY: zoom.anim.y }, { scale: zoom.anim.scale }] }}>
        {children}
      </Animated.View>
    </View>
  );
}
