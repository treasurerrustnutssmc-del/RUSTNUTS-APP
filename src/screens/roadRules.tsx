// The Road Rules (constitution 7.10, 15.4): the NEC's published text, and each member's yearly
// sign-off. Members read the current version and sign it; the NEC publishes new versions; the
// NEC and the boards see who hasn't signed.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { charCount } from '../domain/chat';
import { formatAuDate } from '../domain/dates';
import { displayName, memberName } from '../domain/profile';
import {
  CHANGES_TOO_LONG,
  MAX_RULES_CHANGES,
  MAX_RULES_TEXT,
  NOT_PUBLISHER,
  RULES_EMPTY,
  RULES_TOO_LONG,
  RULES_UPDATED,
  SIGN_OUTDATED,
  currentRoadRules,
  draftProblem,
  homeRoadRulesRow,
  openRoadRules,
  pinnedRoadRules,
  publishProblem,
  publishesRoadRules,
  readVersionLabel,
  roadRulesStatus,
  rulesBlocks,
  signBoxLine,
  signedCountLine,
  signoffChapters,
  signoffGroups,
  signoffLine,
  signoffMembers,
  signoffStart,
  signoffSummary,
} from '../domain/roadRules';
import { writtenRulesText } from '../domain/roadRulesGuide';
import { melbourneDate } from '../domain/rides';
import { routeChapterName } from '../domain/routes';
import type { ClubData, Member, RoadRulesVersion } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { colors, fonts, radius, space, type } from '../theme';
import {
  Body,
  Button,
  Card,
  Chip,
  ConfirmButton,
  Field,
  H1,
  IconBadge,
  Ionicons,
  ListRow,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
  Toggle,
} from '../ui/primitives';
import { chapterColours } from '../ui/RouteBits';
import { IllustratedRulesCard } from './roadRulesGuide';

/** What members see before the NEC has published anything. */
const NOTHING_YET = 'The NEC hasn’t published the version you sign yet. Read the illustrated draft above in the meantime.';

/** Home: the Road Rules, one tap away for every approved member (the draft until the NEC publishes). */
export function HomeRoadRulesRow({ onOpen }: { onOpen: (to: 'RoadRules' | 'RoadRulesGuide') => void }) {
  const { me, data, today } = useClub();
  const row = homeRoadRulesRow(me, data, today);
  if (!row) return null;
  const color = row.tone === 'warn' ? colors.warn : row.tone === 'danger' ? colors.danger : row.tone === 'ok' ? colors.bone : colors.boneDim;
  return (
    <Card style={{ padding: 0, gap: 0 }}>
      <ListRow
        last
        left={<IconBadge icon="document-text-outline" tone={row.tone === 'danger' ? 'red' : undefined} />}
        title="Road Rules"
        subtitle={<Text style={[styles.homeLine, { color }]}>{row.text}</Text>}
        onPress={() => onOpen(row.opens === 'guide' ? 'RoadRulesGuide' : 'RoadRules')}
      />
    </Card>
  );
}

/** "Published 30/09/2026 by Rusty". */
function publishedLine(v: RoadRulesVersion, data: ClubData): string {
  const date = formatAuDate(melbourneDate(v.publishedAt));
  return v.publishedBy ? `Published ${date} by ${memberName(v.publishedBy, data.members)}` : `Published ${date}`;
}

// ---------------------------------------------------------------------------
// Road Rules
// ---------------------------------------------------------------------------

export function RoadRulesScreen({ route: nav, navigation }: RootScreen<'RoadRules'>) {
  const { me, data, today } = useClub();
  // The screen keeps the version it opened on (the one asked for, or the current one then), so the
  // text never changes under the reader and Sign sends the version read. A newer one is offered in
  // a notice instead (pinnedRoadRules).
  const [pin, setPin] = useState(() => openRoadRules(nav.params?.version, data));
  const view = pinnedRoadRules(pin, data, me?.id ?? null);
  // Keep what's shown pinned (the first version to arrive, or your own publish), while rendering,
  // as React recommends for state that follows props.
  if (view.pin !== pin) setPin(view.pin);
  if (!me) return null;
  const current = currentRoadRules(data);
  const publisher = publishesRoadRules(me, data);
  const seesSignoffs = signoffChapters(me, data).length > 0;

  if (!current || !view.version) {
    return (
      <Screen>
        {/* Nothing to sign yet, so the illustrated draft leads: there's always something to read. */}
        <IllustratedRulesCard onRules={() => navigation.navigate('RoadRulesGuide')} onDiagrams={() => navigation.navigate('RoadRulesDiagrams')} />
        <Notice title="No signed version yet">{NOTHING_YET}</Notice>
        {publisher ? (
          <Button label="Write the first version" icon="create-outline" onPress={() => navigation.navigate('EditRoadRules')} />
        ) : null}
      </Screen>
    );
  }

  // An older version opens read-only: no sign box, and a way back to the current one.
  const shown = view.version;
  const older = view.older;
  const newer = view.newer;
  const readNewer = newer ? () => setPin({ shown: newer.number, openedOn: newer.number }) : undefined;
  const toCurrent = () => {
    const { routes, index } = navigation.getState();
    const before = routes[index - 1];
    if (before?.name === 'RoadRules' && !(before.params as RootScreen<'RoadRules'>['route']['params'])?.version) navigation.goBack();
    else navigation.replace('RoadRules');
  };

  return (
    <Screen>
      {/* A newer version was published while this was open: say so, and switch only when asked.
          While it's empty it takes back the screen's gap, so it adds no space above the title. */}
      <View accessibilityLiveRegion="polite" role="alert" style={newer ? null : styles.emptyRegion}>
        {newer && readNewer ? (
          <Notice tone="warn" title="New version">
            <Stack gap={space.md}>
              <Small style={{ color: colors.boneDim }}>{RULES_UPDATED}</Small>
              <Button label={readVersionLabel(newer.number)} icon="refresh" kind="secondary" onPress={readNewer} style={styles.readNewer} />
            </Stack>
          </Notice>
        ) : null}
      </View>

      <Stack gap={space.xs}>
        <H1>{`Version ${shown.number}`}</H1>
        <Text style={styles.published}>{publishedLine(shown, data)}</Text>
      </Stack>

      {older ? (
        <Row style={styles.olderLine}>
          <Ionicons name="time-outline" size={18} color={colors.boneMute} />
          <Text style={styles.olderText}>This is an older version.</Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Read the current one, version ${current.number}`}
            onPress={toCurrent}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.link,
              (pressed || hovered) && { backgroundColor: colors.steel },
            ]}
          >
            <Text style={styles.linkText}>Read the current one</Text>
          </Pressable>
        </Row>
      ) : null}

      {shown.changes ? (
        <View style={styles.changes}>
          <Text style={styles.changesLabel}>What changed</Text>
          <Text selectable style={styles.changesText}>
            {shown.changes}
          </Text>
        </View>
      ) : null}

      <RulesText body={shown.body} />

      {older ? null : <SignBox key={shown.number} version={shown} newer={newer} onReadNewer={readNewer} />}

      {older ? null : (
        <IllustratedRulesCard onRules={() => navigation.navigate('RoadRulesGuide')} onDiagrams={() => navigation.navigate('RoadRulesDiagrams')} />
      )}

      {!older && (publisher || seesSignoffs) ? (
        <Stack gap={space.sm}>
          <SectionTitle title={publisher ? 'For the NEC' : 'For the board'} />
          {publisher ? (
            <Button label="Publish a new version" icon="create-outline" kind="secondary" onPress={() => navigation.navigate('EditRoadRules')} />
          ) : null}
          {seesSignoffs ? (
            <Card style={{ padding: 0, gap: 0 }}>
              <ListRow
                last
                left={<IconBadge icon="people-outline" />}
                title="Who’s signed"
                subtitle={<Text style={styles.rowMeta}>{signoffSummary(me, data, today) ?? ''}</Text>}
                onPress={() => navigation.navigate('RoadRulesSignoffs')}
              />
            </Card>
          ) : null}
        </Stack>
      ) : null}

      {!older && publisher ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Versions" />
          <Card style={{ padding: 0, gap: 0 }}>
            {[...(data.roadRules ?? [])]
              .sort((a, b) => b.number - a.number)
              .map((v, i, all) => (
                <ListRow
                  key={v.number}
                  last={i === all.length - 1}
                  title={`Version ${v.number}`}
                  subtitle={
                    <Text style={styles.rowMeta}>
                      {`${formatAuDate(melbourneDate(v.publishedAt))}${v.fresh || v.number === 1 ? '' : ' · small fix'}`}
                    </Text>
                  }
                  right={v.number === current.number ? <Chip label="Current" tone="bone" /> : undefined}
                  onPress={v.number === current.number ? undefined : () => navigation.push('RoadRules', { version: v.number })}
                />
              ))}
          </Card>
        </Stack>
      ) : null}
    </Screen>
  );
}

/** The text: `# ` lines as stencil headings, `- ` lines as bullets, and paragraphs. */
function RulesText({ body }: { body: string }) {
  const blocks = rulesBlocks(body);
  return (
    <Card style={styles.text}>
      {blocks.map((b, i) =>
        b.kind === 'heading' ? (
          <Text key={i} accessibilityRole="header" style={[styles.heading, i > 0 && { marginTop: space.lg }]}>
            {b.text}
          </Text>
        ) : b.kind === 'bullet' ? (
          <View key={i} style={styles.bullet}>
            <View style={styles.bulletMark} />
            <Text selectable style={[styles.prose, { flex: 1 }]}>
              {b.text}
            </Text>
          </View>
        ) : (
          <Text key={i} selectable style={styles.prose}>
            {b.text}
          </Text>
        ),
      )}
    </Card>
  );
}

/**
 * Sign, or when you signed and until when, with Sign again. `version` is the one on screen, which
 * Sign sends; when it's been overtaken (`newer`), the refusal offers the newer one too.
 */
function SignBox({
  version,
  newer,
  onReadNewer,
}: {
  version: RoadRulesVersion;
  newer: RoadRulesVersion | null;
  onReadNewer?: () => void;
}) {
  const { me, data, today, signRoadRules } = useClub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const status = roadRulesStatus(me, data, today);
  const mine = (data.roadRulesSignoffs ?? []).find((s) => s.memberId === me.id);
  const line = signBoxLine(status, mine?.signedAt ?? null);

  const sign = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      // The version on screen (the pinned one), so a sign-off always means the text the member read.
      await signRoadRules(version.number);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tone = status.state === 'expired' ? colors.danger : status.state === 'due_soon' ? colors.warn : colors.ok;
  const icon = status.state === 'expired' ? 'alert-circle' : status.state === 'due_soon' ? 'time' : 'checkmark-circle';
  const urgent = status.state !== 'current';

  return (
    <Card style={styles.signBox}>
      <View accessibilityLiveRegion="polite">
        {line ? (
          <Row style={styles.signedRow}>
            <Ionicons name={icon} size={22} color={tone} />
            <Text style={[styles.signedText, { color: status.state === 'current' ? colors.bone : tone }]}>{line}</Text>
          </Row>
        ) : (
          <Text style={styles.pledge}>I’ve read the Road Rules and will ride by them</Text>
        )}
      </View>
      <View>
        {line && !urgent ? (
          <Button
            label="Sign again"
            kind="quiet"
            busy={busy}
            accessibilityLabel="Sign again: renew your sign-off from today"
            onPress={sign}
            style={styles.signAgain}
          />
        ) : (
          <Button
            label={line ? 'Sign again' : 'Sign the Road Rules'}
            icon="create-outline"
            busy={busy}
            accessibilityLabel={line ? 'Sign again: I’ve read the Road Rules and will ride by them' : undefined}
            onPress={sign}
            style={styles.signButton}
          />
        )}
        {/* Empty until there's a refusal, so it adds no space under the button. */}
        <View accessibilityLiveRegion="polite" role="alert">
          {error ? (
            <View style={{ marginTop: space.md }}>
              <Notice tone="danger">
                {error === SIGN_OUTDATED && newer && onReadNewer ? (
                  <Stack gap={space.md}>
                    <Small style={{ color: colors.boneDim }}>{error}</Small>
                    <Button
                      label={readVersionLabel(newer.number)}
                      icon="refresh"
                      kind="secondary"
                      onPress={() => {
                        setError(null);
                        onReadNewer();
                      }}
                      style={styles.readNewer}
                    />
                  </Stack>
                ) : (
                  error
                )}
              </Notice>
            </View>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Publish Road Rules
// ---------------------------------------------------------------------------

/** The count shows once the text is past 90% of the limit. */
const COUNT_FROM = Math.floor(MAX_RULES_TEXT * 0.9);

export function EditRoadRulesScreen({ navigation }: RootScreen<'EditRoadRules'>) {
  const { me, data, publishRoadRules } = useClub();
  // The version the editor opened on (0: none), so a publish never lands on someone else's newer one.
  const [seen] = useState(() => currentRoadRules(data)?.number ?? 0);
  const [body, setBody] = useState(() => currentRoadRules(data)?.body ?? '');
  const [written] = useState(writtenRulesText);
  // An empty first version isn't an error until you've started typing.
  const [touched, setTouched] = useState(false);
  const [changes, setChanges] = useState('');
  const [fresh, setFresh] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;
  if (!publishesRoadRules(me, data)) {
    return (
      <Screen>
        <Notice tone="warn">{NOT_PUBLISHER}</Notice>
      </Screen>
    );
  }

  const next = seen + 1;
  const first = seen === 0;
  const count = charCount(body.trim());
  const bodyTooLong = count > MAX_RULES_TEXT;
  const changesTooLong = charCount(changes.trim()) > MAX_RULES_CHANGES;
  const everyone = first || fresh;
  // Empty or too long shows as you type, and Publish stays off until it's fixed.
  const problem = draftProblem({ body, changes, fresh });

  const publish = async () => {
    if (saving) return;
    setError(null);
    const input = { body, changes, fresh };
    const problem = publishProblem(me, input, seen, data);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      await publishRoadRules(input, seen);
      // Back to the Road Rules: the screen it was opened from, or a new one.
      const { routes, index } = navigation.getState();
      if (routes[index - 1]?.name === 'RoadRules') navigation.goBack();
      else navigation.replace('RoadRules');
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Stack gap={space.sm}>
        <Body>
          {first
            ? 'This is the first version: publishing it adopts the Road Rules. Everyone will be asked to sign it.'
            : `This becomes version ${next}. Versions are never edited or removed: a correction is a new version.`}
        </Body>
        {/* The illustrated set's written rules, word for word, so adopting them is one press. */}
        {body.trim() !== written.trim() ? (
          <Button
            label="Fill in the illustrated set’s written rules"
            icon="reader-outline"
            kind="secondary"
            onPress={() => {
              setBody(written);
              setTouched(true);
            }}
          />
        ) : (
          <Small>{'This is the written text of the illustrated Road Rules (30/10/2026), word for word.'}</Small>
        )}
      </Stack>

      <Stack gap={space.xs}>
        <Field
          label="Road Rules"
          value={body}
          onChangeText={(text) => {
            setBody(text);
            setTouched(true);
          }}
          placeholder="# Who’s in charge on the road"
          multiline
          autoCapitalize="sentences"
          hint="Start a line with # for a heading or - for a bullet. Leave a blank line between paragraphs."
          error={problem === RULES_EMPTY && touched ? RULES_EMPTY : bodyTooLong ? RULES_TOO_LONG : null}
          style={styles.bodyInput}
        />
        {count > COUNT_FROM ? (
          <Text style={[styles.count, bodyTooLong && { color: colors.danger }]}>{`${count} of ${MAX_RULES_TEXT} characters`}</Text>
        ) : null}
      </Stack>

      <Field
        label="What changed"
        value={changes}
        onChangeText={setChanges}
        placeholder="e.g. Single file through all towns, not just the busy ones"
        multiline
        autoCapitalize="sentences"
        hint="Optional. Shown at the top of the new version."
        error={changesTooLong ? CHANGES_TOO_LONG : null}
      />

      {first ? null : (
        <Card>
          <Toggle
            label="Everyone signs again"
            description={
              fresh
                ? 'Everyone is asked to sign this version, even if they signed the last one.'
                : 'For a small fix, such as a typo. Sign-offs carry over.'
            }
            value={fresh}
            onChange={setFresh}
          />
        </Card>
      )}

      <Stack gap={space.sm}>
        {saving ? (
          <Button label="Publishing" busy onPress={() => {}} />
        ) : (
          <ConfirmButton
            label={`Publish version ${next}`}
            confirmLabel="Yes, publish"
            confirmNote={
              everyone
                ? first
                  ? 'Everyone will be asked to sign it, and until they do they can’t say Going to a ride.'
                  : 'Everyone will be asked to sign again.'
                : 'Sign-offs carry over: nobody is asked to sign again.'
            }
            kind="primary"
            icon="megaphone-outline"
            disabled={problem !== null}
            onConfirm={publish}
          />
        )}
        <View accessibilityLiveRegion="polite" role="alert">
          {/* Draft problems show once, under their field; this is for what the publish itself hits. */}
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </View>
      </Stack>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Who's signed
// ---------------------------------------------------------------------------

export function RoadRulesSignoffsScreen({ navigation }: RootScreen<'RoadRulesSignoffs'>) {
  const { me, data, today } = useClub();
  const options = signoffChapters(me, data);
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  if (!me) return null;
  if (options.length === 0) {
    return (
      <Screen>
        <Notice tone="warn">Only the NEC and the chapter boards can see who’s signed.</Notice>
      </Screen>
    );
  }
  // Your own chapter to start with, as on the Rides tab.
  const start = signoffStart(me, data) ?? null;
  const chosen = picked !== undefined && options.includes(picked) ? picked : start;

  if (!currentRoadRules(data)) {
    return (
      <Screen>
        <Notice title="No Road Rules yet">{NOTHING_YET}</Notice>
      </Screen>
    );
  }

  const groups = signoffGroups(signoffMembers(chosen, data), data, today);
  const openMember = (memberId: string) => navigation.navigate('MemberDetail', { memberId });

  return (
    <Screen>
      {options.length > 1 ? (
        <View style={styles.filters} accessibilityRole="radiogroup" accessibilityLabel="Show a chapter">
          {options.map((k) => {
            const on = k === chosen;
            const col = chapterColours(k, data);
            const name = routeChapterName(k, data);
            return (
              <Pressable
                key={k ?? 'whole-club'}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                aria-checked={on}
                accessibilityLabel={k === null ? 'Whole club' : `${name} chapter`}
                onPress={() => setPicked(k)}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.filter,
                  on ? { backgroundColor: col.bg, borderColor: col.bg } : (pressed || hovered) && { backgroundColor: colors.steel },
                ]}
              >
                {on ? <Ionicons name="checkmark" size={14} color={col.fg} /> : <View style={[styles.swatch, { backgroundColor: col.bg }]} />}
                <Text style={[styles.filterText, { color: on ? col.fg : colors.boneDim }]}>{name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Row style={styles.countRow}>
        <Ionicons name="people-outline" size={22} color={colors.boneMute} />
        <Text style={styles.countLine} accessibilityLiveRegion="polite">
          {`${signedCountLine(groups)}${options.length > 1 ? '' : ` · ${routeChapterName(chosen, data)}`}`}
        </Text>
      </Row>

      <Group title="Not signed" members={groups.notSigned} data={data} today={today} onMember={openMember} />
      <Group title="Due soon" members={groups.dueSoon} data={data} today={today} onMember={openMember} />
      <Group title="Signed" members={groups.signed} data={data} today={today} onMember={openMember} />
    </Screen>
  );
}

function Group({
  title,
  members,
  data,
  today,
  onMember,
}: {
  title: string;
  members: Member[];
  data: ClubData;
  today: string;
  onMember: (memberId: string) => void;
}) {
  return (
    <Stack gap={space.sm}>
      <SectionTitle title={title} action={<Text style={styles.groupCount}>{members.length}</Text>} />
      <Card style={{ padding: 0, gap: 0 }}>
        {members.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>Nobody.</Small>
          </View>
        ) : (
          members.map((m, i) => (
            <ListRow
              key={m.id}
              last={i === members.length - 1}
              title={displayName(m)}
              subtitle={<Text style={styles.rowMeta}>{signoffLine(m, data, today)}</Text>}
              onPress={() => onMember(m.id)}
            />
          ))
        )}
      </Card>
    </Stack>
  );
}

const styles = StyleSheet.create({
  homeLine: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 0.3 },
  published: { fontFamily: fonts.stencil, fontSize: 15, lineHeight: 20, letterSpacing: 0.4, color: colors.boneDim },
  olderLine: { gap: space.sm, rowGap: 0 },
  olderText: { ...type.body, color: colors.boneDim },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm, marginHorizontal: -space.sm, borderRadius: radius.sm },
  linkText: {
    fontFamily: fonts.stencil,
    fontSize: 15,
    letterSpacing: 0.4,
    color: colors.redText,
    textDecorationLine: 'underline',
    textDecorationColor: colors.redText,
  },
  changes: { gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.steel },
  changesLabel: { fontFamily: fonts.stencil, fontSize: 15, lineHeight: 20, letterSpacing: 0.6, color: colors.bone, textTransform: 'uppercase' },
  changesText: { ...type.body, color: colors.bone },
  text: { gap: space.md, paddingVertical: space.xl },
  heading: { fontFamily: fonts.stencil, fontSize: 19, lineHeight: 26, letterSpacing: 0.6, color: colors.bone },
  prose: { fontFamily: fonts.body, fontSize: 17, lineHeight: 25, color: colors.boneDim },
  bullet: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  // A drawn square, the same tone as the hairlines' strong edge, lined up with the first line of text.
  bulletMark: { width: 6, height: 6, marginTop: 10, marginLeft: space.xs, backgroundColor: colors.boneMute, borderRadius: 1 },
  signBox: { gap: space.lg, paddingVertical: space.xl },
  pledge: { fontFamily: fonts.stencil, fontSize: 19, lineHeight: 26, letterSpacing: 0.4, color: colors.bone },
  signedRow: { gap: space.sm, alignItems: 'flex-start', flexWrap: 'nowrap' },
  signedText: { fontFamily: fonts.stencil, fontSize: 17, lineHeight: 24, letterSpacing: 0.4, flex: 1 },
  signButton: { minHeight: 64 },
  signAgain: { alignSelf: 'flex-start', marginLeft: -space.lg },
  readNewer: { alignSelf: 'flex-start' },
  emptyRegion: { marginBottom: -space.lg },
  rowMeta: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 0.3, color: colors.boneDim },
  bodyInput: { minHeight: 320 },
  count: { fontFamily: fonts.stencil, fontSize: 13, letterSpacing: 0.3, color: colors.boneDim, fontVariant: ['tabular-nums'], textAlign: 'right' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  filter: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  swatch: { width: 12, height: 12, borderRadius: 2 },
  filterText: { fontFamily: fonts.stencil, fontSize: 14, letterSpacing: 0.6, textTransform: 'uppercase' },
  countRow: { gap: space.sm, flexWrap: 'nowrap' },
  countLine: { fontFamily: fonts.stencil, fontSize: 19, lineHeight: 26, letterSpacing: 0.4, color: colors.bone, flexShrink: 1 },
  groupCount: { fontFamily: fonts.stencil, fontSize: 16, color: colors.boneMute },
});
