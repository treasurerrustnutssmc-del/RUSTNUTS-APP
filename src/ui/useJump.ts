// Scroll a screen to a marked place in it: the Board to the list a Needs-you row stands for, or a
// member's page to Ride-ready or Emergency contacts. Measured when asked, against the scroll
// content, as documents.tsx does (a web layout event only follows size, not position).
import { useCallback, useRef } from 'react';
import type { ScrollViewInstance, View } from 'react-native';
import { space } from '../theme';

type Target = React.ComponentRef<typeof View>;

/** A place has to be laid out before it can be measured, so wait for a group just opened to draw. */
const SETTLE_MS = 80;
/** A screen still opening (a slow phone, a tab drawn for the first time) gets a few more tries. */
const TRIES = 8;

export function useJump<K extends string>() {
  const view = useRef<ScrollViewInstance | null>(null);
  const marks = useRef<Partial<Record<K, Target | null>>>({});
  const refs = useRef<Partial<Record<K, (v: Target | null) => void>>>({});
  const scroller = useCallback((v: ScrollViewInstance | null) => {
    view.current = v;
  }, []);
  /** A ref for the place called `key` (the same function each render, so React doesn't re-attach it). */
  const mark = useCallback((key: K) => {
    refs.current[key] ??= (v: Target | null) => {
      marks.current[key] = v;
    };
    return refs.current[key]!;
  }, []);
  /**
   * Scroll so the first of `keys` that is on screen sits near the top (a later key is the fallback,
   * such as the group around a list). Does nothing when none of them is on screen.
   */
  const jump = useCallback((...keys: K[]) => {
    const attempt = (left: number) => {
      setTimeout(() => {
        const scroll = view.current;
        const content = scroll?.getInnerViewRef();
        const target = keys.map((k) => marks.current[k]).find((t) => t);
        if (!scroll || !content || !target) {
          if (left > 1) attempt(left - 1);
          return;
        }
        target.measureLayout(content, (_x: number, y: number) => scroll.scrollTo({ y: Math.max(0, y - space.lg), animated: true }));
      }, SETTLE_MS);
    };
    requestAnimationFrame(() => attempt(TRIES));
  }, []);
  return { scroller, mark, jump };
}
