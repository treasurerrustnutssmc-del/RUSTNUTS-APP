// The illustrated Road Rules: Chris's set (30 October 2026), as he sent it in two documents. The
// condensed rules read one rule at a time with their diagrams in place, the diagrams on their own
// read as a gallery, and any diagram opens full screen to zoom in, since a phone shows a whole
// A4 diagram too small to read.

import { Image } from 'expo-image';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useClub } from '../data/ClubStore';
import { currentRoadRules } from '../domain/roadRules';
import {
  DIAGRAMS,
  GUIDE_RULES,
  diagramById,
  guideStatus,
  diagramLabel,
  figureNumber,
  neighbours,
  ruleByNumber,
  ruleNeighbours,
  type DiagramId,
  type RulesDiagram,
} from '../domain/roadRulesGuide';
import type { RootScreen } from '../navigation/types';
import { colors, fonts, radius, space, type } from '../theme';
import { Button, Card, Chip, Choices, H1, IconBadge, ListRow, Notice, Row, Screen, SectionTitle, Small, Stack } from '../ui/primitives';
import { DIAGRAM_IMAGES } from '../ui/roadRulesDiagrams';

/**
 * How the set is labelled: a draft until the NEC publishes the Road Rules (the club adopting them),
 * then the illustrated version. Said wherever it shows, so nobody mistakes it for what they sign.
 */
function useGuideStatus() {
  const { data } = useClub();
  return guideStatus(!!currentRoadRules(data));
}

const countLine = (n: number): string => (n === 1 ? '1 diagram' : `${n} diagrams`);

// ---------------------------------------------------------------------------
// Contents
// ---------------------------------------------------------------------------

export function RoadRulesGuideScreen({ navigation }: RootScreen<'RoadRulesGuide'>) {
  const status = useGuideStatus();
  return (
    <Screen>
      <Stack gap={space.sm}>
        <H1>Illustrated Road Rules</H1>
        <Row style={styles.metaRow}>
          <Text style={styles.meta}>{status.line}</Text>
          <Chip label={status.chip} tone={status.tone} />
        </Row>
      </Stack>
      <Notice title={status.noteTitle}>{status.note}</Notice>

      <Button
        label={`See all ${DIAGRAMS.length} diagrams`}
        icon="images-outline"
        kind="secondary"
        onPress={() => navigation.navigate('RoadRulesDiagrams')}
      />

      <Stack gap={space.sm}>
        <SectionTitle title="The rules" />
        <Card style={{ padding: 0, gap: 0 }}>
          {GUIDE_RULES.map((r, i) => {
            const pictures = r.blocks.filter((b) => b.kind === 'diagram').length;
            return (
              <ListRow
                key={r.number}
                last={i === GUIDE_RULES.length - 1}
                left={<Text style={styles.ruleNumber}>{r.number}</Text>}
                title={r.title}
                subtitle={pictures ? <Text style={styles.rowMeta}>{countLine(pictures)}</Text> : undefined}
                onPress={() => navigation.navigate('RoadRulesRule', { number: r.number })}
              />
            );
          })}
        </Card>
      </Stack>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One rule
// ---------------------------------------------------------------------------

export function RoadRulesRuleScreen({ route, navigation }: RootScreen<'RoadRulesRule'>) {
  const status = useGuideStatus();
  const rule = ruleByNumber(route.params.number);
  if (!rule) {
    return (
      <Screen>
        <Notice title="Not found">That rule isn’t in the illustrated Road Rules.</Notice>
      </Screen>
    );
  }
  const { prev, next } = ruleNeighbours(rule.number);
  const go = (n: number) => navigation.replace('RoadRulesRule', { number: n });
  return (
    <Screen>
      <Stack gap={space.xs}>
        <Text style={styles.kicker}>{`Rule ${rule.number} of ${GUIDE_RULES.length}`}</Text>
        <H1>{rule.title}</H1>
        <Text style={styles.meta}>{`Illustrated Road Rules · ${status.line}`}</Text>
      </Stack>

      <Card style={styles.text}>
        {rule.blocks.map((b, i) => {
          if (b.kind === 'diagram') {
            const d = diagramById(b.id);
            return d ? (
              <DiagramTile
                key={i}
                diagram={d}
                label={`Figure ${figureNumber(d.id)} · ${d.caption}`}
                onOpen={() => navigation.navigate('RoadRulesDiagram', { id: d.id })}
              />
            ) : null;
          }
          if (b.kind === 'subheading') {
            return (
              <Text key={i} accessibilityRole="header" style={[styles.subheading, i > 0 && { marginTop: space.md }]}>
                {b.text}
              </Text>
            );
          }
          if (b.kind === 'bullet') {
            return (
              <View key={i} style={styles.bullet}>
                <View style={styles.bulletMark} />
                <Text selectable style={[styles.prose, { flex: 1 }]}>
                  {b.text}
                </Text>
              </View>
            );
          }
          return (
            <Text key={i} selectable style={styles.prose}>
              {b.text}
            </Text>
          );
        })}
      </Card>

      <StepButtons
        prevLabel={prev ? `Rule ${prev}` : null}
        nextLabel={next ? `Rule ${next}` : null}
        onPrev={prev ? () => go(prev) : undefined}
        onNext={next ? () => go(next) : undefined}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// The diagrams on their own
// ---------------------------------------------------------------------------

export function RoadRulesDiagramsScreen({ navigation }: RootScreen<'RoadRulesDiagrams'>) {
  const status = useGuideStatus();
  return (
    <Screen>
      <Stack gap={space.sm}>
        <H1>Road Rules diagrams</H1>
        <Row style={styles.metaRow}>
          <Text style={styles.meta}>{status.line}</Text>
          <Chip label={status.chip} tone={status.tone} />
        </Row>
        <Small>Read them with the written rules. Tap a diagram to zoom in.</Small>
      </Stack>
      {DIAGRAMS.map((d) => (
        <DiagramTile key={d.id} diagram={d} label={diagramLabel(d)} onOpen={() => navigation.navigate('RoadRulesDiagram', { id: d.id })} />
      ))}
      <Button label="Read the written rules" icon="reader-outline" kind="secondary" onPress={() => navigation.navigate('RoadRulesGuide')} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One diagram, full screen, to zoom
// ---------------------------------------------------------------------------

type Zoom = '1' | '2' | '3';
const ZOOMS: { value: Zoom; label: string }[] = [
  { value: '1', label: 'Fit' },
  { value: '2', label: '2×' },
  { value: '3', label: '3×' },
];

export function RoadRulesDiagramScreen({ route, navigation }: RootScreen<'RoadRulesDiagram'>) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [zoom, setZoom] = useState<Zoom>('2');
  const d = diagramById(route.params.id);
  if (!d) {
    return (
      <Screen>
        <Notice title="Not found">That diagram isn’t in the illustrated Road Rules.</Notice>
      </Screen>
    );
  }
  const image = DIAGRAM_IMAGES[d.id];
  // Fit is the screen's width less the side gutters; 2× and 3× scroll both ways. The full-size
  // image is 1600 pixels wide, so even 3× on a phone stays sharp.
  const fit = width - space.lg * 2;
  const shown = fit * Number(zoom);
  const { prev, next } = neighbours(d.id);
  const go = (id: DiagramId) => navigation.replace('RoadRulesDiagram', { id });
  const rule = ruleByNumber(d.rule);
  // Back to the rule when the viewer was opened from it, so the stack doesn't gain a second copy.
  const toRule = (n: number) => {
    const { routes, index } = navigation.getState();
    const before = routes[index - 1];
    if (before?.name === 'RoadRulesRule' && (before.params as { number?: number } | undefined)?.number === n) navigation.goBack();
    else navigation.navigate('RoadRulesRule', { number: n });
  };

  return (
    <View style={styles.viewer}>
      <View style={styles.viewerTop}>
        {rule ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Read Rule ${rule.number}, ${rule.title}`}
            onPress={() => toRule(rule.number)}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.ruleLink, (pressed || hovered) && { backgroundColor: colors.steel }]}
          >
            <Text style={[styles.kicker, styles.kickerLink]}>{`Rule ${rule.number} · ${rule.title}`}</Text>
          </Pressable>
        ) : null}
        <Text accessibilityRole="header" style={styles.viewerTitle}>
          {d.caption}
        </Text>
        <Choices options={ZOOMS} value={zoom} onChange={setZoom} />
      </View>
      <ScrollView style={styles.viewerScroll} contentContainerStyle={{ padding: space.lg }}>
        <ScrollView horizontal scrollEnabled={zoom !== '1'} showsHorizontalScrollIndicator={zoom !== '1'}>
          <View style={styles.plate}>
            <Image
              source={image.source}
              style={{ width: shown, height: (shown * image.height) / image.width }}
              contentFit="contain"
              accessibilityLabel={`Diagram: ${d.caption}`}
            />
          </View>
        </ScrollView>
      </ScrollView>
      <View style={[styles.viewerBottom, { paddingBottom: insets.bottom + space.md }]}>
        <StepButtons
          prevLabel={prev ? 'Previous' : null}
          nextLabel={next ? 'Next' : null}
          onPrev={prev ? () => go(prev) : undefined}
          onNext={next ? () => go(next) : undefined}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** A diagram at the card's width on a white plate (the diagrams are drawn on white), with its label. Tap to zoom. */
function DiagramTile({ diagram, label, onOpen }: { diagram: RulesDiagram; label: string; onOpen: () => void }) {
  const image = DIAGRAM_IMAGES[diagram.id];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Open full screen to zoom.`}
      onPress={onOpen}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.tile, (pressed || hovered) && { borderColor: colors.bone }]}
    >
      <View style={styles.plate}>
        <Image source={image.source} style={{ width: '100%', aspectRatio: image.width / image.height }} contentFit="contain" />
      </View>
      <Row style={styles.tileFoot}>
        <Text style={styles.tileLabel}>{label}</Text>
        <IconBadge icon="expand-outline" />
      </Row>
    </Pressable>
  );
}

/** Previous and Next, side by side, either left out at the ends. */
function StepButtons({
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
}: {
  prevLabel: string | null;
  nextLabel: string | null;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  return (
    <View style={styles.steps}>
      <View style={styles.step}>
        {prevLabel && onPrev ? <Button label={prevLabel} icon="chevron-back" kind="secondary" onPress={onPrev} /> : null}
      </View>
      <View style={styles.step}>
        {nextLabel && onNext ? <Button label={nextLabel} icon="chevron-forward" kind="secondary" onPress={onNext} /> : null}
      </View>
    </View>
  );
}

/** For the Road Rules screen: the way into the illustrated set. */
export function IllustratedRulesCard({ onRules, onDiagrams }: { onRules: () => void; onDiagrams: () => void }) {
  const status = useGuideStatus();
  return (
    <Stack gap={space.sm}>
      <SectionTitle title={status.section} />
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow
          left={<IconBadge icon="reader-outline" />}
          title="Illustrated Road Rules"
          subtitle={<Text style={styles.rowMeta}>{`${GUIDE_RULES.length} rules with diagrams · ${status.line}`}</Text>}
          onPress={onRules}
        />
        <ListRow
          last
          left={<IconBadge icon="images-outline" />}
          title="Road Rules diagrams"
          subtitle={<Text style={styles.rowMeta}>{`${DIAGRAMS.length} diagrams · ${status.chip}`}</Text>}
          onPress={onDiagrams}
        />
      </Card>
    </Stack>
  );
}

const styles = StyleSheet.create({
  metaRow: { gap: space.sm, flexWrap: 'wrap' },
  meta: { fontFamily: fonts.stencil, fontSize: 15, lineHeight: 20, letterSpacing: 0.4, color: colors.boneDim },
  kicker: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 1, color: colors.redText, textTransform: 'uppercase' },
  ruleLink: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: space.sm,
    marginHorizontal: -space.sm,
    borderRadius: radius.sm,
  },
  kickerLink: { textDecorationLine: 'underline', textDecorationColor: colors.redText },
  ruleNumber: {
    fontFamily: fonts.stencil,
    fontSize: 19,
    minWidth: 28,
    textAlign: 'right',
    color: colors.bone,
    fontVariant: ['tabular-nums'],
  },
  rowMeta: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 0.3, color: colors.boneDim },
  text: { gap: space.md, paddingVertical: space.xl },
  subheading: { fontFamily: fonts.stencil, fontSize: 19, lineHeight: 26, letterSpacing: 0.6, color: colors.bone },
  prose: { fontFamily: fonts.body, fontSize: 17, lineHeight: 25, color: colors.boneDim },
  bullet: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  bulletMark: { width: 6, height: 6, marginTop: 10, marginLeft: space.xs, backgroundColor: colors.boneMute, borderRadius: 1 },
  tile: { gap: space.sm, padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.ink2 },
  plate: { backgroundColor: colors.logoPlate, borderRadius: radius.sm, overflow: 'hidden' },
  tileFoot: { gap: space.sm, flexWrap: 'nowrap', paddingHorizontal: space.xs },
  tileLabel: { ...type.name, flex: 1 },
  steps: { flexDirection: 'row', gap: space.md },
  step: { flex: 1 },
  viewer: { flex: 1, backgroundColor: colors.ink },
  viewerTop: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.lg },
  viewerTitle: { fontFamily: fonts.stencil, fontSize: 19, lineHeight: 26, letterSpacing: 0.6, color: colors.bone },
  viewerScroll: { flex: 1 },
  viewerBottom: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.line },
});
