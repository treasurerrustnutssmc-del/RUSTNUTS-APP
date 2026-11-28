// Me › Rides in my calendar: a member's own calendar link, so the rides they mark Going show in
// Google, Outlook, Apple or any other calendar and keep up as rides change.
// Spec: docs/superpowers/specs/2026-11-28-personal-ride-calendar-design.md.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Share } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { RootParams } from '../navigation/types';
import { useClub } from '../data/ClubStore';
import { SUPABASE_URL } from '../data/config';
import { calendarFeedLinks, type CalendarFeedLinks } from '../domain/calendarFeedLinks';
import { colors, space } from '../theme';
import { Body, Button, Card, ConfirmButton, H2, IconBadge, ListRow, Notice, Screen, Small, Stack } from '../ui/primitives';

/** The row on Me that opens the screen. */
export function RideCalendarRow() {
  const navigation = useNavigation<NavigationProp<RootParams>>();
  return (
    <Card style={{ padding: 0, gap: 0 }}>
      <ListRow
        last
        left={<IconBadge icon="calendar-outline" />}
        title="Rides in my calendar"
        subtitle="Rides you mark Going, in Google, Outlook or your phone’s calendar"
        onPress={() => navigation.navigate('RideCalendar')}
      />
    </Card>
  );
}

export function RideCalendarScreen() {
  const { calendarToken } = useClub();
  const [links, setLinks] = useState<CalendarFeedLinks | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Busy from the start while the link loads (no state set inside the effect itself).
  const [busy, setBusy] = useState(!!calendarToken);
  const [renewed, setRenewed] = useState(false);

  // Turns a token into the links, or says what went wrong.
  const show = useCallback((token: Promise<string>, fresh: boolean, live: () => boolean = () => true) => {
    token
      .then((t) => {
        const next = calendarFeedLinks(SUPABASE_URL, t);
        if (!next) throw new Error('The app couldn’t make your link. Try again.');
        if (!live()) return;
        setError(null);
        setLinks(next);
        if (fresh) setRenewed(true);
      })
      .catch((e: Error) => live() && setError(e.message))
      .finally(() => live() && setBusy(false));
  }, []);

  // The club's actions are made afresh on each refresh, so the link loads once per visit, not per refresh.
  const ask = useRef(calendarToken);
  useEffect(() => {
    ask.current = calendarToken;
  });
  const hasLink = !!calendarToken;
  useEffect(() => {
    if (!hasLink || !ask.current) return;
    let live = true;
    show(ask.current(false), false, () => live);
    return () => {
      live = false;
    };
  }, [hasLink, show]);

  // Google and Outlook open in the phone's own browser, where the member is already signed in.
  const open = (url: string) => Linking.openURL(url).catch(() => setError('The phone couldn’t open that. Use Share the link instead.'));

  return (
    <Screen>
      <Body>
        Every ride you mark Going shows up in your own calendar. If a ride is moved or changed, it moves in your calendar too. If it’s
        called off, it shows as called off. If you change to Maybe or Not going, it comes off.
      </Body>
      <Small>
        Calendars check for changes on their own clock, usually every few hours, so a change can take a while to show. Each leg of a ride
        shows as its own entry.
      </Small>

      {!calendarToken ? <Notice>In the demo there’s no real link. In the club’s app this gives you your own private link.</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {error && !links && calendarToken ? (
        <Button
          label="Try again"
          kind="secondary"
          icon="refresh"
          busy={busy}
          onPress={() => {
            setBusy(true);
            setError(null);
            show(calendarToken(false), false);
          }}
        />
      ) : null}
      {renewed ? (
        <Notice tone="ok" notAnError>
          New link made. The old one has stopped working, so add this one to your calendar again.
        </Notice>
      ) : null}

      <H2>Add it to your calendar</H2>
      <Stack gap={space.sm}>
        <Button
          label="Add to Google Calendar"
          icon="logo-google"
          disabled={!links}
          busy={busy && !links}
          onPress={() => links && open(links.google)}
        />
        <Small>
          On a phone this opens Google Calendar in your browser. Once it’s added there, the rides show in the Google Calendar app too.
        </Small>
        <Button
          label="Add to Outlook"
          kind="secondary"
          icon="mail-outline"
          disabled={!links}
          onPress={() => links && open(links.outlook)}
        />
        <Button
          label="Outlook for work or school"
          kind="quiet"
          size="small"
          disabled={!links}
          onPress={() => links && open(links.outlookWork)}
        />
        {Platform.OS === 'android' ? null : (
          <Button
            label="Add to Apple Calendar"
            kind="secondary"
            icon="logo-apple"
            disabled={!links}
            onPress={() => links && open(links.webcal)}
          />
        )}
        <Button
          label="Share the link"
          kind="secondary"
          icon="share-outline"
          disabled={!links}
          onPress={() =>
            links && Share.share({ message: links.https }).catch(() => setError('Sharing didn’t work here. Copy the link below instead.'))
          }
        />
        <Small>
          For any other calendar app, share the link to yourself and add it as a calendar from a web address (sometimes called subscribe).
        </Small>
        {links ? (
          <Small selectable style={{ color: colors.boneDim }}>
            {links.https}
          </Small>
        ) : null}
      </Stack>

      <H2>Keep it to yourself</H2>
      <Body>
        Anyone with this link can see the rides you’re going on, so don’t post it in a chat. If it gets passed on, make a new one.
      </Body>
      <ConfirmButton
        label="Make a new link"
        confirmLabel="Yes, make a new link"
        confirmNote="Your old link stops working. You’ll need to add the new one to your calendar again."
        kind="secondary"
        icon="refresh"
        disabled={busy || !links}
        onConfirm={() => {
          setBusy(true);
          setError(null);
          setRenewed(false);
          if (calendarToken) show(calendarToken(true), true);
        }}
      />
    </Screen>
  );
}
