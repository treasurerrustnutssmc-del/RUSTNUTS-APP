// Ride weather: the forecast for a ride's hours, along its route or at its meeting place, above
// "Your answer" so riders see it before they say Going. Open-Meteo, asked by the phone.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { NOT_ANSWERING, demoSource, liveSource, rideForecast, type RideForecast } from '../data/weather';
import { formatAuDate, weekday } from '../domain/dates';
import { melbourneTime } from '../domain/rides';
import { routeOf } from '../domain/routes';
import type { Ride } from '../domain/types';
import type { WeatherSummary } from '../domain/weather';
import { colors, fonts, space, type } from '../theme';
import { Body, Button, Card, Ionicons, Notice, Row, SectionTitle, Small, Stack, type IconName } from '../ui/primitives';
import { openLink } from '../ui/openLink';

const OPEN_METEO = 'https://open-meteo.com/';

type State = { kind: 'loading' } | { kind: 'failed'; message: string } | RideForecast;

const temps = (s: WeatherSummary) => (s.low === s.high ? `${s.high}°` : `${s.low}–${s.high}°`);

export function RideWeatherSection({ ride }: { ride: Ride }) {
  const { data, today, isDemo } = useClub();
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{ key: string; result: State } | null>(null);
  const route = routeOf(ride.id, data);
  // Only the parts of the ride the forecast depends on, so a new RSVP doesn't ask again.
  const key = [ride.id, ride.startsAt, ride.endsAt, ride.allDay, ride.location, ride.cancelledAt, route?.id, route?.updatedAt, today, isDemo, attempt].join('|');

  useEffect(() => {
    let alive = true;
    rideForecast(ride, data, today, isDemo ? demoSource : liveSource)
      .then((result) => alive && setAnswer({ key, result }))
      .catch(() => alive && setAnswer({ key, result: { kind: 'failed', message: NOT_ANSWERING } }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A stale answer (for an older key) shows as loading.
  const state: State = answer?.key === key ? answer.result : { kind: 'loading' };
  if (state.kind === 'over') return null;

  return (
    <Stack gap={space.sm}>
      <SectionTitle title="Weather" />
      <Card>
        {state.kind === 'loading' ? (
          <View style={[styles.inline, { gap: space.sm }]} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={colors.boneMute} />
            <Small>Getting the forecast…</Small>
          </View>
        ) : state.kind === 'failed' ? (
          <>
            <View accessibilityLiveRegion="polite" role="alert">
              <Notice tone="danger">{state.message}</Notice>
            </View>
            <Button label="Try again" icon="refresh" kind="secondary" onPress={() => setAttempt((n) => n + 1)} />
          </>
        ) : state.kind === 'later' ? (
          <Row style={styles.quiet}>
            <Ionicons name="calendar-outline" size={18} color={colors.boneMute} />
            <Body style={{ flex: 1 }}>{`The forecast opens on ${weekday(state.opensOn)} ${formatAuDate(state.opensOn)}.`}</Body>
          </Row>
        ) : state.kind === 'none' ? (
          <Row style={styles.quiet}>
            <Ionicons name="cloud-offline-outline" size={18} color={colors.boneMute} />
            <Body style={{ flex: 1 }}>No forecast yet: this ride has no route, and its meeting place can’t be found on the map.</Body>
          </Row>
        ) : (
          <Forecast state={state} />
        )}
      </Card>
    </Stack>
  );
}

function Forecast({ state }: { state: Extract<RideForecast, { kind: 'ready' }> }) {
  const { headline, rows, headsUps } = state.view;
  return (
    <>
      <View
        style={{ gap: space.xs }}
        accessible
        accessibilityLabel={`${headline.sky}, ${temps(headline)}, ${headline.rain}% chance of rain, gusts to ${headline.gust} km/h`}
      >
        <View style={[styles.inline, styles.headline]}>
          <Ionicons name={headline.icon as IconName} size={36} color={colors.bone} />
          <Text style={[styles.sky, { flex: 1 }]} numberOfLines={2}>
            {headline.sky.toUpperCase()}
          </Text>
          <Text style={styles.bigTemp}>{temps(headline)}</Text>
        </View>
        <Facts summary={headline} />
      </View>

      {headsUps.length > 0 ? (
        <Stack gap={space.xs}>
          {headsUps.map((h) => (
            <Row key={h} style={styles.headsUp}>
              <Ionicons name="alert-circle" size={18} color={colors.warn} style={{ marginTop: 2 }} />
              <Text style={styles.headsUpText}>{h}</Text>
            </Row>
          ))}
        </Stack>
      ) : null}

      {rows.length > 1 ? (
        <View style={styles.rows}>
          {rows.map((r, i) => (
            <View
              key={i}
              style={styles.row}
              accessible
              accessibilityLabel={`${r.label}: ${r.summary.sky}, ${temps(r.summary)}, ${r.summary.rain}% chance of rain, gusts to ${r.summary.gust} km/h`}
            >
              <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
                <Text style={[type.name, { flex: 1 }]} numberOfLines={2}>
                  {r.label}
                </Text>
                <Ionicons name={r.summary.icon as IconName} size={20} color={colors.boneDim} />
                <Text style={styles.rowTemp}>{temps(r.summary)}</Text>
              </Row>
              <Facts summary={r.summary} withSky />
            </View>
          ))}
        </View>
      ) : null}

      <Stack gap={2}>
        {state.place ? <Small>{`At ${state.place}, from the ride’s meeting place.`}</Small> : null}
        {state.clipped ? <Small>Later days open closer to the ride.</Small> : null}
        <Row style={{ gap: 4 }}>
          <Small>{`Updated ${melbourneTime(new Date(state.fetchedAt).toISOString())}. Forecast:`}</Small>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Forecast by Open-Meteo, open their site"
            hitSlop={{ left: 4, right: 12 }}
            style={styles.creditLink}
            onPress={() => openLink(OPEN_METEO).catch(() => {})}
          >
            <Small style={styles.credit}>Open-Meteo</Small>
          </Pressable>
        </Row>
      </Stack>
    </>
  );
}

/** Rain chance and gusts, in the stencil, with the sky word on rows. */
function Facts({ summary, withSky = false }: { summary: WeatherSummary; withSky?: boolean }) {
  return (
    <Row style={styles.facts}>
      {withSky ? <Text style={styles.fact}>{summary.sky}</Text> : null}
      <Row style={styles.factPair}>
        <Ionicons name="umbrella-outline" size={14} color={colors.boneMute} />
        <Text style={styles.fact}>{`Rain ${summary.rain}%`}</Text>
      </Row>
      <Row style={styles.factPair}>
        <Ionicons name="flag-outline" size={14} color={colors.boneMute} />
        <Text style={styles.fact}>{`Gusts ${summary.gust} km/h`}</Text>
      </Row>
    </Row>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center' },
  quiet: { gap: space.sm, alignItems: 'flex-start', flexWrap: 'nowrap' },
  headline: { gap: space.md },
  sky: { fontFamily: fonts.stencil, fontSize: 19, letterSpacing: 1, color: colors.bone },
  bigTemp: { fontFamily: fonts.stencil, fontSize: 26, letterSpacing: 1, color: colors.bone },
  facts: { gap: space.md, flexWrap: 'wrap' },
  factPair: { gap: 4 },
  fact: { fontFamily: fonts.stencil, fontSize: 14, lineHeight: 20, letterSpacing: 0.4, color: colors.boneDim },
  headsUp: { gap: space.sm, alignItems: 'flex-start', flexWrap: 'nowrap' },
  headsUpText: { flex: 1, fontFamily: fonts.body, fontSize: 15, lineHeight: 22, fontWeight: '600', color: colors.warn },
  rows: { borderTopWidth: 1, borderTopColor: colors.line },
  row: { gap: 2, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.line },
  rowTemp: { fontFamily: fonts.stencil, fontSize: 16, letterSpacing: 0.4, color: colors.bone, minWidth: 64, textAlign: 'right' },
  creditLink: { minHeight: 44, justifyContent: 'center' },
  credit: { color: colors.boneDim, textDecorationLine: 'underline' },
});
