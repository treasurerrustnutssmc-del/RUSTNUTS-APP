import { useNavigation } from '@react-navigation/native';
import type { NavigationAction } from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import { space } from '../theme';
import { Button, Notice, Row } from './primitives';

/**
 * "Leave without saving?" for an edit form. While `dirty`, going back is held and an in-screen
 * prompt asks first (no pop-up dialogs in this app). Call `markSaved()` just before leaving after a
 * save so the guard steps aside. Show `prompt` near the top of the form.
 */
export function useUnsavedGuard(dirty: boolean) {
  const navigation = useNavigation();
  const allow = useRef(false);
  const [held, setHeld] = useState<NavigationAction | null>(null);

  useEffect(() => {
    return navigation.addListener('beforeRemove', (e) => {
      if (allow.current || !dirty) return;
      e.preventDefault();
      setHeld(e.data.action);
    });
  }, [navigation, dirty]);

  const prompt = held ? (
    <Notice tone="warn" title="Leave without saving?">
      What you’ve typed here hasn’t been saved.
      <Row style={{ gap: space.sm, marginTop: space.sm }}>
        <Button label="Keep editing" kind="secondary" size="small" onPress={() => setHeld(null)} />
        <Button
          label="Leave"
          kind="quiet"
          size="small"
          onPress={() => {
            allow.current = true;
            navigation.dispatch(held);
          }}
        />
      </Row>
    </Notice>
  ) : null;

  return { prompt, held: held !== null, markSaved: () => { allow.current = true; } };
}
