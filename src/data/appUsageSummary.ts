// The board's App usage card: the live summary (public.app_usage_summary, board only) or, in the
// demo build, made-up visits so the card shows what it looks like. Loaded each time the card opens.

import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import type { UsageVisit } from '../domain/appUsage';
import { liveDataOn } from './reviewMode';
import { friendlyError, supabase } from './supabase';

export interface UsageError {
  screen: string;
  detail: string;
  hits: number;
  last: string;
  platforms: string;
}

export interface UsageSummary {
  visits: UsageVisit[];
  errors: UsageError[];
}

export interface UsageSummaryValue {
  ready: boolean;
  summary: UsageSummary;
  loadError: string | null;
}

const EMPTY: UsageSummary = { visits: [], errors: [] };

/** Made-up visits for the demo Board screen. */
export function demoUsage(): UsageSummary {
  const visits: UsageVisit[] = [];
  for (let i = 0; i < 40; i++) {
    const screens = ['Home'];
    if (i % 2 === 0) screens.push('Rides', 'RideDetail');
    if (i % 3 === 0) screens.push('Chats', 'Chat');
    if (i % 5 === 0) screens.push('Shop', 'ShopCart');
    if (i % 10 === 0) screens.push('ShopCheckout');
    if (i % 20 === 0) screens.push('ShopOrder');
    visits.push({ screens });
  }
  for (let i = 0; i < 6; i++) visits.push({ screens: i < 4 ? ['Welcome', 'SignIn', 'Home'] : ['Welcome', 'SignIn'] });
  return {
    visits,
    errors: [
      { screen: 'SignIn', detail: 'That code didn’t work. Ask for a new one.', hits: 3, last: '', platforms: 'ios' },
      { screen: 'ShopCheckout', detail: 'Add a delivery address first.', hits: 2, last: '', platforms: 'android' },
    ],
  };
}

export function useUsageSummary(days: number, board: boolean): UsageSummaryValue {
  const live = liveDataOn();
  const key = `${days}`;
  const [state, setState] = useState<{ key: string | null; summary: UsageSummary; loadError: string | null }>({
    key: null,
    summary: EMPTY,
    loadError: null,
  });

  useEffect(() => {
    if (!live || !board) return;
    let current = true;
    (supabase() as unknown as SupabaseClient).rpc('app_usage_summary', { p_days: days }).then(({ data, error }) => {
      if (!current) return;
      if (error) setState({ key, summary: EMPTY, loadError: friendlyError(error).message });
      else setState({ key, summary: { ...EMPTY, ...((data ?? {}) as Partial<UsageSummary>) }, loadError: null });
    });
    return () => {
      current = false;
    };
  }, [live, board, days, key]);

  if (!board) return { ready: true, summary: EMPTY, loadError: null };
  if (!live) return { ready: true, summary: demoUsage(), loadError: null };
  // Until this choice of days has loaded, say so rather than show the last one's numbers.
  if (state.key !== key) return { ready: false, summary: EMPTY, loadError: null };
  return { ready: true, summary: state.summary, loadError: state.loadError };
}
