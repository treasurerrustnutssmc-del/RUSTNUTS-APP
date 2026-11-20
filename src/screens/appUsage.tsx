import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { useUsageSummary } from '../data/appUsageSummary';
import { useUsageSharing } from '../data/usage';
import { ERROR_KIND_LABEL, journeyCounts, screenLabel, screenTable } from '../domain/appUsage';
import { isAnyBoard } from '../domain/social/help';
import { Card, Choices, Notice, Row, SectionTitle, Small, Toggle } from '../ui/primitives';
import { colors, fonts, space, type } from '../theme';

type Days = '7' | '30';

/**
 * "App usage" on the Board screen: which screens members reach, where visits end, which jobs get
 * finished, and the error messages people saw. Nothing about who (Jeff chose anonymous, 21 Nov 2026).
 * Spec: docs/superpowers/specs/2026-11-21-app-usage-design.md
 */
export function AppUsage() {
  const { me, data } = useClub();
  const board = isAnyBoard(me, data.positions);
  const [days, setDays] = useState<Days>('7');
  const { ready, summary, loadError } = useUsageSummary(Number(days), board);
  if (!board) return null;
  const screens = screenTable(summary.visits);
  const journeys = journeyCounts(summary.visits).filter((j) => j.started > 0);
  const top = screens.slice(0, 6);
  const endings = [...screens].filter((s) => s.endedHere > 0).sort((a, b) => b.endedHere - a.endedHere).slice(0, 4);
  return (
    <>
      <SectionTitle title="App usage" />
      <Card>
        <Choices
          options={[
            { value: '7', label: 'Last 7 days' },
            { value: '30', label: 'Last 30 days' },
          ]}
          value={days}
          onChange={setDays}
        />
        {loadError ? (
          <Notice tone="warn">{loadError}</Notice>
        ) : !ready ? (
          <Small>Loading…</Small>
        ) : summary.visits.length === 0 ? (
          <Small>No app visits counted yet. Each time someone opens the app, the screens they go through are counted, with nothing about who.</Small>
        ) : (
          <>
            <Row style={{ gap: space.lg }}>
              <Figure label="App visits" value={summary.visits.length} />
              <Figure label="Screens seen" value={screens.reduce((n, s) => n + s.views, 0)} />
              <Figure label="Errors shown" value={summary.errors.reduce((n, e) => n + e.hits, 0)} />
            </Row>

            <Heading text="Most used" />
            {top.map((s) => (
              <Line key={s.name} left={screenLabel(s.name)} right={`${s.visits}`} />
            ))}

            {journeys.length ? <Heading text="Jobs started and finished" /> : null}
            {journeys.map((j) => (
              <View key={j.id} style={{ gap: 2 }}>
                <Line left={j.label} right={`${j.finished} of ${j.started}`} />
                <Small>{j.steps.map((s) => `${screenLabel(s.name)} ${s.visits}`).join(' › ')}</Small>
              </View>
            ))}

            <Heading text="Where visits ended" />
            {endings.map((s) => (
              <Line key={s.name} left={screenLabel(s.name)} right={`${s.endedHere}`} />
            ))}

            {summary.errors.length ? <Heading text="Where errors showed" /> : null}
            {summary.errors.slice(0, 6).map((e) => (
              <View key={`${e.screen}:${e.detail}`} style={{ gap: 2 }}>
                <Line left={screenLabel(e.screen)} right={`${e.hits}×`} />
                <Small>{ERROR_KIND_LABEL[e.detail] ?? e.detail}</Small>
              </View>
            ))}
          </>
        )}
        <Small>Counted per app visit: screens, and what kind of error showed (never its words). No names, no phones, no locations. Members can switch it off on the Me tab, under Privacy.</Small>
      </Card>
    </>
  );
}

function Heading({ text }: { text: string }) {
  return <Text style={[type.name, { color: colors.bone, marginTop: space.sm }]}>{text}</Text>;
}

function Line({ left, right }: { left: string; right: string }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Text style={[type.body, { flex: 1 }]}>{left}</Text>
      <Text style={[type.name, { color: colors.bone }]}>{right}</Text>
    </Row>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ fontFamily: fonts.stencil, fontSize: 28, color: colors.bone }}>{value}</Text>
      <Small>{label}</Small>
    </View>
  );
}

/** "Help improve the app" on the Me tab's Privacy card: on unless the member switches it off (kept on this phone). */
export function UsageToggle() {
  const usage = useUsageSharing();
  return (
    <Toggle
      label="Help improve the app"
      description="Counts which screens get used and which errors show up, with nothing about who you are. The board uses it to make the app easier."
      value={usage.on}
      onChange={usage.set}
    />
  );
}
