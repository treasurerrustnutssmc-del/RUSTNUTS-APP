// The notifications explainer's answer on this phone ("Turn on" or "Not now"), kept so the card
// shows once. The ride reminders and the push sign-up read it before bringing up the phone's own
// prompt (src/domain/notifyIntro.ts decides).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import type { IntroAnswer } from '../domain/notifyIntro';

const KEY = 'push.intro';

let answer: IntroAnswer = undefined;
let reading: Promise<IntroAnswer> | null = null;
const listeners = new Set<() => void>();

const tell = () => listeners.forEach((l) => l());

/** The answer saved on this phone, or null when the card hasn't been answered. */
export function introAnswer(): Promise<IntroAnswer> {
  if (answer !== undefined) return Promise.resolve(answer);
  reading ??= AsyncStorage.getItem(KEY)
    .then((v): IntroAnswer => (v === 'on' || v === 'later' ? v : null))
    .catch((): IntroAnswer => null)
    .then((v) => {
      if (answer === undefined) {
        answer = v;
        tell();
      }
      return answer;
    });
  return reading;
}

export async function setIntroAnswer(next: 'on' | 'later'): Promise<void> {
  answer = next;
  tell();
  await AsyncStorage.setItem(KEY, next).catch(() => undefined);
}

/** The answer, read once and kept up to date. Undefined while it's being read. */
export function useIntroAnswer(): IntroAnswer {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      introAnswer();
      return () => listeners.delete(l);
    },
    () => answer,
  );
}
