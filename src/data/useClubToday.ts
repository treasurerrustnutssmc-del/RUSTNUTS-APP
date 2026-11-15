// The club's date (Melbourne, wherever the phone is), kept as state so it moves on by itself: at
// each Melbourne midnight while the app is open, and whenever the app comes back to the front (a
// phone asleep overnight may hold its timers back). The providers settle the club data on it, so a
// stint whose until date has passed ends on screen without a reload (src/domain/acting.ts).

import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { everyClubDay } from '../domain/acting';
import { melbourneDate } from '../domain/rides';

const clubToday = () => melbourneDate(new Date().toISOString());

export function useClubToday(): string {
  const [today, setToday] = useState(clubToday);
  useEffect(() => everyClubDay(setToday), []);
  useEffect(() => {
    // As at src/data/appUpdate.ts: back to the front reads the clock again.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setToday(clubToday());
    });
    return () => sub.remove();
  }, []);
  return today;
}
