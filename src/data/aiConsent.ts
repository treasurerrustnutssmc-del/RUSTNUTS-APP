// The member's Agree / Not now for the club's AI features, kept on this phone per member
// (src/domain/aiConsent.ts). Works the same in the demo, so App Review sees the card too.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { hasAiConsent, readAiConsent, saveAiConsent, type AiConsentRecord, type AiFeature } from '../domain/aiConsent';
import { useClub } from './ClubStore';

export interface AiConsent {
  /** False until the saved answer has been read. */
  loaded: boolean;
  agreed: boolean;
  agree(): Promise<void>;
}

export function useAiConsent(feature: AiFeature): AiConsent {
  const { me, today } = useClub();
  const memberId = me?.id ?? null;
  const [state, setState] = useState<{ memberId: string | null; record: AiConsentRecord | null }>({ memberId, record: null });

  useEffect(() => {
    if (!memberId) return;
    let live = true;
    readAiConsent(AsyncStorage, memberId).then((record) => live && setState({ memberId, record }));
    return () => {
      live = false;
    };
  }, [memberId]);

  const agree = useCallback(async () => {
    if (!memberId) return;
    const record = await saveAiConsent(AsyncStorage, memberId, feature, today);
    setState({ memberId, record });
  }, [memberId, feature, today]);

  // A record read for another member (a sign-out and in) doesn't count.
  const record = state.memberId === memberId ? state.record : null;
  return { loaded: !!record, agreed: !!record && hasAiConsent(record, feature), agree };
}
