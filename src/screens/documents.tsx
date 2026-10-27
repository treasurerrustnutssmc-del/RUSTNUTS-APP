// The document library (constitution v4 2.2, 15.3 to 15.7): the club's controlled documents in
// the order of authority. Every version shows its title, label, approving body, approval date and
// commencement date (15.5); old versions stay readable. Members read and sign; the NEC and the
// chapter boards add documents, publish versions, record approvals and mark reviews.

import { useNavigation, type NavigationProp } from "@react-navigation/native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from "react-native";
import { useClub } from "../data/ClubStore";
import { charCount } from "../domain/chat";
import { formatAuDate, parseAuDate, typeDate } from "../domain/dates";
import {
  APPROVING_BODIES,
  BODY_TOO_LONG,
  CHANGES_TOO_LONG,
  KIND_LABELS,
  LABEL_TOO_LONG,
  MAX_BODY,
  MAX_CHANGES,
  MAX_LABEL,
  NO_DOCUMENT,
  NO_VERSION,
  NOT_IN_FORCE,
  TITLE_TOO_LONG,
  MAX_TITLE,
  approvingBodyLabel,
  askedToSignDocument,
  countingSignoff,
  createDocumentProblem,
  documentBanner,
  documentBlocks,
  documentContents,
  findInDocument,
  inForce,
  latestNumber,
  libraryGroups,
  publishVersionProblem,
  publishesDocument,
  readsDocument,
  recordApprovalProblem,
  reviewDueOn,
  reviewLine,
  reviewsDue,
  shownVersion,
  signStatus,
  stateLabel,
  versionState,
  versionsOf,
  type ApprovalInput,
  type VersionState,
} from "../domain/documents";
import { displayName, memberName } from "../domain/profile";
import { currentRoadRules } from "../domain/roadRules";
import { melbourneDate } from "../domain/rides";
import type {
  ApprovingBody,
  ClubData,
  ClubDocument,
  DocumentKind,
  DocumentVersion,
  Member,
} from "../domain/types";
import type { RootParams, RootScreen } from "../navigation/types";
import { colors, fonts, radius, space, type } from "../theme";
import {
  Body,
  Button,
  Card,
  Chip,
  Choices,
  ConfirmButton,
  Field,
  H1,
  IconBadge,
  Ionicons,
  KeyValue,
  ListRow,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
  Toggle,
} from "../ui/primitives";

type Nav = NavigationProp<RootParams>;
type BlockView = React.ComponentRef<typeof View>;

const EMPTY_LIBRARY = "The club hasn’t put any documents in the app yet.";
const NOT_RECORDED = "Not recorded yet";

const STATE_TONE: Record<VersionState, "ok" | "warn" | "bone"> = {
  in_force: "ok",
  awaiting: "warn",
  upcoming: "warn",
  superseded: "bone",
};

/** "Published 25/10/2026 by Rusty", or without a name for an imported version. */
function publishedLine(v: DocumentVersion, data: ClubData): string {
  const date = formatAuDate(melbourneDate(v.publishedAt));
  return v.publishedBy
    ? `Published ${date} by ${memberName(v.publishedBy, data.members)}`
    : `Published ${date}`;
}

/** Whether `me` publishes in any scope: the NEC, or a chapter's board. */
function publishesAny(me: Member | null, data: ClubData): boolean {
  return (
    publishesDocument(me, null, data.positions) ||
    data.chapters.some((c) => publishesDocument(me, c.id, data.positions))
  );
}

// ---------------------------------------------------------------------------
// Entry rows
// ---------------------------------------------------------------------------

/** Board: the library, with how many reviews are due. Only for those who publish somewhere. */
export function DocumentsBoardRow({ last }: { last?: boolean }) {
  const { me, data, today } = useClub();
  const navigation = useNavigation<Nav>();
  if (!publishesAny(me, data)) return null;
  const due = reviewsDue(me, data, today);
  return (
    <ListRow
      last={last}
      left={
        <IconBadge icon="library-outline" tone={due > 0 ? "red" : "steel"} />
      }
      title="Documents"
      subtitle={
        due > 0
          ? `${due} review${due === 1 ? "" : "s"} due`
          : "Constitution, bylaws, policies and forms"
      }
      onPress={() => navigation.navigate("Documents")}
    />
  );
}

/** Me: the library, with how many documents are waiting for your signature. */
export function DocumentsMeRow() {
  const { me, data, today } = useClub();
  const navigation = useNavigation<Nav>();
  if (!me) return null;
  const toSign = (data.documents ?? []).filter(
    (d) => signStatus(me, d, data, today) === "unsigned",
  ).length;
  return (
    <>
      <SectionTitle title="Club documents" />
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow
          last
          left={
            <IconBadge
              icon="library-outline"
              tone={toSign > 0 ? "red" : "steel"}
            />
          }
          title={toSign > 0 ? `${toSign} to sign` : "Constitution and bylaws"}
          subtitle="The club’s rules, policies and forms"
          onPress={() => navigation.navigate("Documents")}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export function DocumentsScreen({ navigation }: RootScreen<"Documents">) {
  const { me, data } = useClub();
  if (!me) return null;
  const groups = libraryGroups(me, data);
  // The Road Rules keep their own screen, which only approved members reach.
  const rules =
    me.approval === "approved" ? { version: currentRoadRules(data) } : null;
  const sections = [...groups];
  if (rules && !sections.some((g) => g.level === 5))
    sections.push({
      level: 5,
      chapterId: null,
      heading: "Procedures and forms",
      documents: [],
    });
  const adds = publishesAny(me, data);

  return (
    <Screen>
      <Body>
        In the constitution’s order of authority (2.2): law first, then each
        document below. A lower document can’t override a higher one.
      </Body>

      {sections.length === 0 ? (
        <Notice title="Nothing here yet">{EMPTY_LIBRARY}</Notice>
      ) : null}

      {sections.map((g) => (
        <Stack key={`${g.level}-${g.chapterId ?? "club"}`} gap={space.sm}>
          <SectionTitle title={g.heading} />
          <Card style={{ padding: 0, gap: 0 }}>
            {g.documents.map((d, i) => (
              <DocumentRow
                key={d.id}
                doc={d}
                last={i === g.documents.length - 1 && !(g.level === 5 && rules)}
                onPress={() => navigation.navigate("Document", { id: d.id })}
              />
            ))}
            {g.level === 5 && rules ? (
              <ListRow
                last
                left={<IconBadge icon="document-text-outline" />}
                title="Road Rules"
                subtitle={
                  <Text style={styles.rowMeta}>
                    {rules.version
                      ? `Version ${rules.version.number} · signed once a year`
                      : "Not published yet"}
                  </Text>
                }
                onPress={() => navigation.navigate("RoadRules")}
              />
            ) : null}
          </Card>
        </Stack>
      ))}

      {adds ? (
        <Button
          label="Add a document"
          icon="add"
          kind="secondary"
          onPress={() => navigation.navigate("NewDocument")}
        />
      ) : null}
    </Screen>
  );
}

function DocumentRow({
  doc,
  last,
  onPress,
}: {
  doc: ClubDocument;
  last: boolean;
  onPress: () => void;
}) {
  const { me, data, today } = useClub();
  const shown = shownVersion(doc, data, today);
  const state = shown ? versionState(shown, data, today) : null;
  const mustSign = !!me && signStatus(me, doc, data, today) === "unsigned";
  const review = publishesDocument(me, doc.chapterId, data.positions)
    ? reviewLine(doc, data, today)
    : null;
  const overdue = review?.startsWith("Review overdue") ?? false;
  return (
    <ListRow
      last={last}
      left={
        <IconBadge
          icon="document-text-outline"
          tone={mustSign ? "red" : "steel"}
        />
      }
      title={doc.title}
      subtitle={
        <Text style={styles.rowMeta}>
          {shown && state
            ? `${shown.label} · ${stateLabel(state, shown)}`
            : "No version yet"}
        </Text>
      }
      right={
        mustSign ? (
          <Chip label="Sign" tone="red" />
        ) : review ? (
          <Chip
            label={overdue ? "Review overdue" : "Review due"}
            tone={overdue ? "danger" : "warn"}
          />
        ) : undefined
      }
      onPress={onPress}
    />
  );
}

// ---------------------------------------------------------------------------
// One document
// ---------------------------------------------------------------------------

export function DocumentScreen({ route, navigation }: RootScreen<"Document">) {
  const { me, data, today, loadDocumentBody } = useClub();
  const doc = (data.documents ?? []).find((d) => d.id === route.params.id);
  // The version on screen stays put while it's open (a newer one is offered in a banner), so the
  // text never changes under the reader and Sign sends the version read.
  const [pinned, setPinned] = useState<string | undefined>(() =>
    doc ? shownVersion(doc, data, today)?.id : undefined,
  );
  const fallback = doc ? shownVersion(doc, data, today) : undefined;
  if (!pinned && fallback) setPinned(fallback.id);
  const openId = route.params.version ?? pinned;
  const open = (data.documentVersions ?? []).find((v) => v.id === openId);

  // A failed load, for the version it was for, so another version starts clean.
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(
    null,
  );
  const [loadTry, setLoadTry] = useState(0);
  useEffect(() => {
    if (!open || open.body !== null) return;
    let live = true;
    const id = open.id;
    loadDocumentBody(id).catch(
      (e) => live && setFailed({ id, message: (e as Error).message }),
    );
    return () => {
      live = false;
    };
    // The body arriving changes `open`, so only the version (and a retry) should start a load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.id, loadTry]);

  const scroller = useRef<ScrollViewInstance | null>(null);
  const blocks = useRef<(BlockView | null)[]>([]);
  const [lit, setLit] = useState<number | null>(null);
  // Measured when asked, against the scroll content, since the find results and contents above
  // the text grow and shrink (and a web layout event only follows size, not position).
  const jump = (index: number) => {
    setLit(index);
    const view = scroller.current;
    const block = blocks.current[index];
    const content = view?.getInnerViewRef();
    if (!view || !block || !content) return;
    block.measureLayout(content, (_x: number, y: number) =>
      view.scrollTo({ y: Math.max(0, y - space.xl), animated: true }),
    );
  };

  if (!me) return null;
  if (!doc || !readsDocument(me, doc)) {
    return (
      <Screen>
        <Notice tone="warn">{NO_DOCUMENT}</Notice>
      </Screen>
    );
  }
  const publisher = publishesDocument(me, doc.chapterId, data.positions);
  if (!open) {
    return (
      <Screen>
        <H1>{doc.title}</H1>
        <Notice title="No version yet">
          Nothing has been published for this document yet.
        </Notice>
        {publisher ? (
          <Button
            label="Publish the first version"
            icon="create-outline"
            onPress={() =>
              navigation.navigate("PublishDocument", { id: doc.id })
            }
          />
        ) : null}
      </Screen>
    );
  }

  const state = versionState(open, data, today);
  const banner = documentBanner(open, data, today);
  const readVersion = (v: DocumentVersion) => {
    setLit(null);
    navigation.setParams({ version: v.id });
  };

  return (
    <Screen scroller={(view) => (scroller.current = view)}>
      <Stack gap={space.sm}>
        <H1>{doc.title}</H1>
        <Row style={{ gap: space.sm }}>
          <Chip label={stateLabel(state, open)} tone={STATE_TONE[state]} />
          <Chip label={KIND_LABELS[doc.kind]} tone="bone" />
        </Row>
      </Stack>

      {banner ? (
        <Notice tone={banner.kind === "superseded" ? "warn" : "info"}>
          <Stack gap={space.md}>
            <Small style={{ color: colors.boneDim }}>
              {banner.kind === "superseded"
                ? "You’re reading a superseded version. It’s kept as a club record."
                : `${banner.target.label} is ${banner.state === "awaiting" ? "awaiting approval" : stateLabel(banner.state, banner.target).toLowerCase()}.`}
            </Small>
            <Button
              label={
                banner.kind === "superseded"
                  ? `Read the one in force (${banner.target.label})`
                  : `Read ${banner.target.label}`
              }
              icon="arrow-forward"
              kind="secondary"
              onPress={() => readVersion(banner.target)}
              style={{ alignSelf: "flex-start" }}
            />
          </Stack>
        </Notice>
      ) : null}

      <ControlCard doc={doc} version={open} />

      {open.whatChanged ? (
        <View style={styles.changes}>
          <Text style={styles.changesLabel}>What changed</Text>
          <Text selectable style={styles.changesText}>
            {open.whatChanged}
          </Text>
        </View>
      ) : null}

      {open.body === null ? (
        failed?.id === open.id ? (
          <Notice tone="danger" title="Couldn’t load the text">
            <Stack gap={space.md}>
              <Small style={{ color: colors.boneDim }}>{failed.message}</Small>
              <Button
                label="Try again"
                icon="refresh"
                kind="secondary"
                onPress={() => {
                  setFailed(null);
                  setLoadTry((n) => n + 1);
                }}
                style={{ alignSelf: "flex-start" }}
              />
            </Stack>
          </Notice>
        ) : (
          <Button
            label="Loading the text"
            busy
            onPress={() => {}}
            kind="secondary"
          />
        )
      ) : (
        <DocumentText
          body={open.body}
          lit={lit}
          onJump={jump}
          blockRef={(i, v) => (blocks.current[i] = v)}
        />
      )}

      {state === "in_force" ? <SignBox doc={doc} version={open} /> : null}

      {publisher ? <PublisherTools doc={doc} open={open} /> : null}

      <Versions doc={doc} open={open} onOpen={readVersion} />
    </Screen>
  );
}

/** The five facts 15.5 asks every controlled document to state. */
function ControlCard({
  doc,
  version,
}: {
  doc: ClubDocument;
  version: DocumentVersion;
}) {
  const { data } = useClub();
  const missing = version.approvedOn === null;
  return (
    <Card>
      <KeyValue
        label="Version"
        value={
          version.label === `v${version.number}`
            ? version.label
            : `${version.label} (number ${version.number})`
        }
      />
      <KeyValue
        label="Approved by"
        value={approvingBodyLabel(version.approvingBody) ?? NOT_RECORDED}
        tone={missing ? "warn" : undefined}
      />
      <KeyValue
        label="Approved on"
        value={
          version.approvedOn ? formatAuDate(version.approvedOn) : NOT_RECORDED
        }
        tone={missing ? "warn" : undefined}
      />
      <KeyValue
        label="Commences"
        value={
          version.commencesOn ? formatAuDate(version.commencesOn) : NOT_RECORDED
        }
        tone={missing ? "warn" : undefined}
      />
      <Small>{`${publishedLine(version, data)}${doc.chapterId ? ` · ${data.chapters.find((c) => c.id === doc.chapterId)?.name ?? ""} chapter` : " · Club-wide"}`}</Small>
    </Card>
  );
}

/**
 * The text, with a find box and a contents list when it's long enough to need them. Each block
 * hands over its view, so a tap on a heading or a match scrolls straight to it.
 */
function DocumentText({
  body,
  lit,
  onJump,
  blockRef,
}: {
  body: string;
  lit: number | null;
  onJump: (index: number) => void;
  blockRef: (index: number, view: BlockView | null) => void;
}) {
  const blocks = useMemo(() => documentBlocks(body), [body]);
  const contents = useMemo(() => documentContents(body), [body]);
  const [query, setQuery] = useState("");
  const hits = useMemo(() => findInDocument(body, query), [body, query]);
  const [showContents, setShowContents] = useState(false);
  const long = contents.length >= 3 || charCount(body) > 3000;
  const searching = charCount(query.trim()) >= 2;

  return (
    <>
      {long ? (
        <Stack gap={space.sm}>
          <Field
            label="Find in this document"
            value={query}
            onChangeText={setQuery}
            placeholder="e.g. quorum"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityHint="Lists the paragraphs that contain what you type"
          />
          {searching ? (
            <Card style={{ padding: 0, gap: 0 }}>
              <View style={styles.hitsHead} accessibilityLiveRegion="polite">
                <Small>
                  {hits.length === 0
                    ? "No matches."
                    : hits.length >= 50
                      ? "The first 50 matches"
                      : `${hits.length} match${hits.length === 1 ? "" : "es"}`}
                </Small>
              </View>
              {hits.map((h, i) => (
                <ListRow
                  key={h.index}
                  last={i === hits.length - 1}
                  title={
                    <Text style={styles.hitText} numberOfLines={2}>
                      {h.text}
                    </Text>
                  }
                  onPress={() => onJump(h.index)}
                />
              ))}
            </Card>
          ) : null}
        </Stack>
      ) : null}

      {contents.length >= 3 ? (
        <Card style={{ padding: 0, gap: 0 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showContents }}
            aria-expanded={showContents}
            onPress={() => setShowContents((s) => !s)}
            style={({
              pressed,
              hovered,
            }: {
              pressed: boolean;
              hovered?: boolean;
            }) => [
              styles.contentsHead,
              (pressed || hovered) && { backgroundColor: colors.steel },
            ]}
          >
            <Ionicons name="list" size={20} color={colors.boneDim} />
            <Text
              style={styles.contentsTitle}
            >{`Contents · ${contents.length}`}</Text>
            <Ionicons
              name={showContents ? "chevron-up" : "chevron-down"}
              size={20}
              color={colors.boneDim}
            />
          </Pressable>
          {showContents
            ? contents.map((c, i) => (
                <ListRow
                  key={c.index}
                  last={i === contents.length - 1}
                  title={<Text style={styles.contentsItem}>{c.text}</Text>}
                  onPress={() => onJump(c.index)}
                />
              ))
            : null}
        </Card>
      ) : null}

      <Card style={styles.text}>
        {blocks.map((b, i) => (
          <View
            key={i}
            ref={(v) => blockRef(i, v)}
            style={[
              i === lit && styles.lit,
              b.kind === "heading" && i > 0 && { marginTop: space.lg },
            ]}
          >
            {b.kind === "heading" ? (
              <Text accessibilityRole="header" style={styles.heading}>
                {b.text}
              </Text>
            ) : b.kind === "bullet" ? (
              <View style={styles.bullet}>
                <View style={styles.bulletMark} />
                <Text selectable style={[styles.prose, { flex: 1 }]}>
                  {b.text}
                </Text>
              </View>
            ) : (
              <Text selectable style={styles.prose}>
                {b.text}
              </Text>
            )}
          </View>
        ))}
      </Card>
    </>
  );
}

/** Sign, or when you signed, with Sign again. Only on the version in force, for members it asks. */
function SignBox({
  doc,
  version,
}: {
  doc: ClubDocument;
  version: DocumentVersion;
}) {
  const { me, data, today, signDocument } = useClub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const status = signStatus(me, doc, data, today);
  if (status === "none") return null;
  const mine = countingSignoff(me, doc, data, today);
  const sign = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await signDocument(version.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={styles.signBox}>
      <View accessibilityLiveRegion="polite">
        {mine ? (
          <Row style={styles.signedRow}>
            <Ionicons name="checkmark-circle" size={22} color={colors.ok} />
            <Text
              style={styles.signedText}
            >{`Signed on ${formatAuDate(melbourneDate(mine.signedAt))}.`}</Text>
          </Row>
        ) : (
          <Text style={styles.pledge}>I’ve read this document</Text>
        )}
      </View>
      <View>
        {mine ? (
          <Button
            label="Sign again"
            kind="quiet"
            busy={busy}
            accessibilityLabel="Sign again from today"
            onPress={sign}
            style={styles.signAgain}
          />
        ) : (
          <Button
            label="Sign"
            icon="create-outline"
            busy={busy}
            accessibilityLabel={`Sign ${doc.title} ${version.label}`}
            onPress={sign}
            style={styles.signButton}
          />
        )}
        <View accessibilityLiveRegion="polite" role="alert">
          {error ? (
            <View style={{ marginTop: space.md }}>
              <Notice tone="danger">
                {error === NOT_IN_FORCE
                  ? `${error} A newer version came into force while this was open.`
                  : error}
              </Notice>
            </View>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

function PublisherTools({
  doc,
  open,
}: {
  doc: ClubDocument;
  open: DocumentVersion;
}) {
  const { data, today, markDocumentReviewed } = useClub();
  const navigation = useNavigation<Nav>();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const state = versionState(open, data, today);
  const current = inForce(doc, data, today);
  const due = reviewDueOn(doc, data, today);
  const review = reviewLine(doc, data, today);
  const asked = askedToSignDocument(doc, data);
  const signed = asked.filter(
    (m) => signStatus(m, doc, data, today) === "signed",
  ).length;
  return (
    <Stack gap={space.sm}>
      <SectionTitle
        title={doc.chapterId === null ? "For the NEC" : "For the board"}
      />
      <Button
        label="Publish a new version"
        icon="create-outline"
        kind="secondary"
        onPress={() => navigation.navigate("PublishDocument", { id: doc.id })}
      />
      {open.approvedOn === null && state !== "superseded" ? (
        <Button
          label={`Record ${open.label}’s approval`}
          icon="checkmark-done-outline"
          kind="secondary"
          onPress={() =>
            navigation.navigate("DocumentApproval", { versionId: open.id })
          }
        />
      ) : null}
      {doc.reviewMonths !== null && current ? (
        <Card>
          <Text
            style={[
              styles.reviewLine,
              review?.startsWith("Review overdue")
                ? { color: colors.danger }
                : review
                  ? { color: colors.warn }
                  : null,
            ]}
          >
            {review ?? `Next review due ${formatAuDate(due)}`}
          </Text>
          <Small>{`Reviewed every ${doc.reviewMonths} months. A review with no change is recorded here; a change is a new version.`}</Small>
          <ConfirmButton
            label="Mark reviewed, no change"
            confirmLabel="Yes, reviewed today"
            kind="secondary"
            icon="checkmark"
            onConfirm={async () => {
              setError(null);
              setDone(null);
              try {
                await markDocumentReviewed(doc.id);
                setDone(`Reviewed on ${formatAuDate(today)}.`);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
          <View accessibilityLiveRegion="polite" role="alert">
            {error ? (
              <Notice tone="danger">{error}</Notice>
            ) : done ? (
              <Notice tone="ok">{done}</Notice>
            ) : null}
          </View>
        </Card>
      ) : null}
      {doc.asksSignOff ? (
        <Card style={{ padding: 0, gap: 0 }}>
          <ListRow
            last
            left={<IconBadge icon="people-outline" />}
            title="Who’s signed"
            subtitle={
              <Text style={styles.rowMeta}>
                {current
                  ? `${signed} of ${asked.length} signed`
                  : "Nothing in force to sign yet"}
              </Text>
            }
            onPress={() =>
              navigation.navigate("DocumentSignoffs", { id: doc.id })
            }
          />
        </Card>
      ) : null}
    </Stack>
  );
}

/** Every version, newest first, kept as club records (15.5). */
function Versions({
  doc,
  open,
  onOpen,
}: {
  doc: ClubDocument;
  open: DocumentVersion;
  onOpen: (v: DocumentVersion) => void;
}) {
  const { data, today } = useClub();
  const all = [...versionsOf(doc.id, data)].reverse();
  if (all.length < 2) return null;
  return (
    <Stack gap={space.sm}>
      <SectionTitle title="Versions" />
      <Card style={{ padding: 0, gap: 0 }}>
        {all.map((v, i) => {
          const s = versionState(v, data, today);
          return (
            <ListRow
              key={v.id}
              last={i === all.length - 1}
              title={v.label}
              subtitle={
                <Text
                  style={styles.rowMeta}
                >{`${stateLabel(s, v)} · published ${formatAuDate(melbourneDate(v.publishedAt))}`}</Text>
              }
              right={
                v.id === open.id ? <Chip label="Open" tone="bone" /> : undefined
              }
              onPress={v.id === open.id ? undefined : () => onOpen(v)}
            />
          );
        })}
      </Card>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Add a document
// ---------------------------------------------------------------------------

const REVIEW_OPTIONS = [
  { value: "none", label: "None" },
  { value: "12", label: "12 months" },
  { value: "24", label: "2 years" },
  { value: "36", label: "3 years" },
];

export function NewDocumentScreen({ navigation }: RootScreen<"NewDocument">) {
  const { me, data, createDocument } = useClub();
  const scopes = [
    ...(publishesDocument(me, null, data.positions)
      ? [{ value: "club", label: "Whole club" }]
      : []),
    ...data.chapters
      .filter((c) => publishesDocument(me, c.id, data.positions))
      .map((c) => ({ value: c.id, label: c.name })),
  ];
  const [scope, setScope] = useState<string>(scopes[0]?.value ?? "club");
  const chapterId = scope === "club" ? null : scope;
  const has = (k: DocumentKind) =>
    (data.documents ?? []).some((d) => d.kind === k);
  const kinds: { value: DocumentKind; label: string }[] =
    chapterId === null
      ? [
          ...(has("registered_rules")
            ? []
            : [
                {
                  value: "registered_rules" as const,
                  label: "Registered Rules",
                },
              ]),
          ...(has("constitution")
            ? []
            : [{ value: "constitution" as const, label: "Constitution" }]),
          { value: "policy", label: "NEC policy or schedule" },
          { value: "procedure", label: "Procedure or form" },
        ]
      : [
          { value: "policy", label: "Bylaw or policy" },
          { value: "procedure", label: "Procedure or form" },
        ];
  const [kind, setKind] = useState<DocumentKind>("policy");
  const shownKind = kinds.some((k) => k.value === kind) ? kind : "policy";
  const [title, setTitle] = useState("");
  const [asksSignOff, setAsksSignOff] = useState(false);
  const [review, setReview] = useState("12");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;
  if (scopes.length === 0) {
    return (
      <Screen>
        <Notice tone="warn">
          Only the NEC and the chapter boards add documents.
        </Notice>
      </Screen>
    );
  }
  const input = {
    chapterId,
    kind: shownKind,
    title,
    asksSignOff,
    reviewMonths: review === "none" ? null : Number(review),
  };
  const titleLong = charCount(title.trim()) > MAX_TITLE;

  const add = async () => {
    if (busy) return;
    setError(null);
    const problem = createDocumentProblem(me, input, data);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const id = await createDocument(input);
      navigation.replace("PublishDocument", { id });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Screen>
      {scopes.length > 1 ? (
        <Choices
          label="Whose document"
          options={scopes}
          value={scope}
          onChange={setScope}
        />
      ) : null}
      <Choices
        label="Kind"
        options={kinds}
        value={shownKind}
        onChange={setKind}
      />
      <Field
        label="Title"
        value={title}
        onChangeText={setTitle}
        placeholder={
          chapterId === null ? "e.g. Fee schedule" : "e.g. West Chapter bylaws"
        }
        autoCapitalize="sentences"
        error={titleLong ? TITLE_TOO_LONG : null}
      />
      <Card>
        <Toggle
          label="Members sign it"
          description={
            asksSignOff
              ? `${chapterId === null ? "Every member" : "Every member of the chapter"} (not Legacy) is asked to sign that they’ve read it.`
              : "Members can read it. Nobody is asked to sign."
          }
          value={asksSignOff}
          onChange={setAsksSignOff}
        />
      </Card>
      <Choices
        label="Review every"
        options={REVIEW_OPTIONS}
        value={review}
        onChange={setReview}
      />
      <Stack gap={space.sm}>
        <Button
          label="Add, then write the first version"
          icon="arrow-forward"
          busy={busy}
          disabled={title.trim() === "" || titleLong}
          onPress={add}
        />
        <View accessibilityLiveRegion="polite" role="alert">
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </View>
      </Stack>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Approval fields (publishing, and recording an approval later)
// ---------------------------------------------------------------------------

function useDate(initial: string | null) {
  const [text, setRaw] = useState(formatAuDate(initial));
  const trimmed = text.trim();
  const iso = trimmed ? parseAuDate(trimmed) : null;
  return {
    text,
    setText: (t: string) => setRaw(typeDate(t)),
    iso,
    error: trimmed && !iso ? "Use DD/MM/YYYY, like 08/11/2026." : null,
  };
}

function useApproval(defaultBody: ApprovingBody | null) {
  const [body, setBody] = useState<ApprovingBody | null>(defaultBody);
  const approved = useDate(null);
  const commences = useDate(null);
  const value: ApprovalInput = {
    approvingBody: body,
    approvedOn: approved.iso,
    commencesOn: commences.iso,
  };
  const bad = !!approved.error || !!commences.error;
  return { body, setBody, approved, commences, value, bad };
}

function ApprovalFields({ a }: { a: ReturnType<typeof useApproval> }) {
  return (
    <>
      <Choices
        label="Approved by"
        options={APPROVING_BODIES}
        value={a.body}
        onChange={a.setBody}
      />
      <Field
        label="Approved on"
        value={a.approved.text}
        onChangeText={a.approved.setText}
        placeholder="DD/MM/YYYY"
        keyboardType="number-pad"
        error={a.approved.error}
        hint="The date of the meeting or vote that approved it."
      />
      <Field
        label="Commences"
        value={a.commences.text}
        onChangeText={a.commences.setText}
        placeholder="DD/MM/YYYY"
        keyboardType="number-pad"
        error={a.commences.error}
        hint="When it takes effect. It can be later than the approval."
      />
    </>
  );
}

const defaultBody = (doc: ClubDocument): ApprovingBody =>
  doc.chapterId === null ? "nec" : "chapter_board";

// ---------------------------------------------------------------------------
// Publish a version
// ---------------------------------------------------------------------------

/** The count shows once the text is past 90% of the limit. */
const COUNT_FROM = Math.floor(MAX_BODY * 0.9);

export function PublishDocumentScreen({
  route,
  navigation,
}: RootScreen<"PublishDocument">) {
  const { me, data, today, publishDocumentVersion, loadDocumentBody } =
    useClub();
  const doc = (data.documents ?? []).find((d) => d.id === route.params.id);
  // The version the editor opened on (0: none), so a publish never lands on someone else's newer one.
  const [seen] = useState(() => latestNumber(route.params.id, data));
  const latest = versionsOf(route.params.id, data).at(-1);
  const [label, setLabel] = useState(`v${seen + 1}`);
  const [body, setBody] = useState(latest?.body ?? "");
  const [prefilled, setPrefilled] = useState(!latest || latest.body !== null);
  const [changes, setChanges] = useState("");
  const [fresh, setFresh] = useState(true);
  const [withApproval, setWithApproval] = useState(false);
  const approval = useApproval(doc ? defaultBody(doc) : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from the newest text, loading it first in live.
  useEffect(() => {
    if (prefilled || !latest) return;
    loadDocumentBody(latest.id)
      .then((b) => setBody((typed) => (typed === "" ? b : typed)))
      .catch(() => {})
      .finally(() => setPrefilled(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!me) return null;
  if (!doc || !publishesDocument(me, doc.chapterId, data.positions)) {
    return (
      <Screen>
        <Notice tone="warn">
          {doc
            ? doc.chapterId === null
              ? "Only the NEC can do that."
              : "Only that chapter’s board can do that."
            : NO_DOCUMENT}
        </Notice>
      </Screen>
    );
  }

  const first = seen === 0;
  const count = charCount(body.trim());
  const input = {
    label,
    body,
    whatChanged: changes,
    freshSignOff: fresh,
    approval: withApproval
      ? approval.value
      : { approvingBody: null, approvedOn: null, commencesOn: null },
  };
  const ready =
    label.trim() !== "" &&
    body.trim() !== "" &&
    count <= MAX_BODY &&
    charCount(changes.trim()) <= MAX_CHANGES &&
    !(withApproval && approval.bad);

  const publish = async () => {
    if (saving) return;
    setError(null);
    const problem = publishVersionProblem(me, doc.id, seen, input, data, today);
    if (problem) return setError(problem);
    setSaving(true);
    try {
      const id = await publishDocumentVersion(doc.id, seen, input);
      const { routes, index } = navigation.getState();
      const before = routes[index - 1];
      if (
        before?.name === "Document" &&
        (before.params as RootParams["Document"]).id === doc.id
      )
        navigation.popTo("Document", { id: doc.id, version: id });
      else navigation.replace("Document", { id: doc.id, version: id });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>{doc.title}</H1>
        <Body>
          {first
            ? "This is the first version."
            : `This becomes number ${seen + 1}. Versions are never edited or removed: a correction is a new version, and the old ones stay as club records.`}
        </Body>
      </Stack>

      <Field
        label="Version label"
        value={label}
        onChangeText={setLabel}
        placeholder="e.g. v2 or 2026–27"
        error={charCount(label.trim()) > MAX_LABEL ? LABEL_TOO_LONG : null}
        hint="What the club calls this version."
      />

      <Stack gap={space.xs}>
        <Field
          label="Text"
          value={body}
          onChangeText={setBody}
          placeholder={prefilled ? "# 1. Name" : "Loading the current text…"}
          editable={prefilled}
          multiline
          autoCapitalize="sentences"
          hint="Start a line with # for a heading or - for a bullet. Leave a blank line between paragraphs."
          error={count > MAX_BODY ? BODY_TOO_LONG : null}
          style={styles.bodyInput}
        />
        {count > COUNT_FROM ? (
          <Text
            style={[styles.count, count > MAX_BODY && { color: colors.danger }]}
          >{`${count} of ${MAX_BODY} characters`}</Text>
        ) : null}
      </Stack>

      <Field
        label="What changed"
        value={changes}
        onChangeText={setChanges}
        multiline
        autoCapitalize="sentences"
        hint="Optional. Shown at the top of the new version."
        error={
          charCount(changes.trim()) > MAX_CHANGES ? CHANGES_TOO_LONG : null
        }
      />

      {doc.asksSignOff && !first ? (
        <Card>
          <Toggle
            label="Everyone signs again"
            description={
              fresh
                ? "Everyone is asked to sign this version once it’s in force."
                : "For a small fix, such as a typo. Sign-offs carry over."
            }
            value={fresh}
            onChange={setFresh}
          />
        </Card>
      ) : null}

      <Card>
        <Toggle
          label="Record its approval now"
          description={
            withApproval
              ? "Who approved it, when, and when it takes effect (15.5)."
              : "It shows as awaiting approval until someone records it."
          }
          value={withApproval}
          onChange={setWithApproval}
        />
        {withApproval ? <ApprovalFields a={approval} /> : null}
      </Card>

      <Stack gap={space.sm}>
        {saving ? (
          <Button label="Publishing" busy onPress={() => {}} />
        ) : (
          <ConfirmButton
            label={`Publish ${label.trim() || "this version"}`}
            confirmLabel="Yes, publish"
            confirmNote="Members can read it straight away. It can’t be edited afterwards."
            kind="primary"
            icon="megaphone-outline"
            disabled={!ready}
            onConfirm={publish}
          />
        )}
        <View accessibilityLiveRegion="polite" role="alert">
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </View>
      </Stack>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Record approval
// ---------------------------------------------------------------------------

export function DocumentApprovalScreen({
  route,
  navigation,
}: RootScreen<"DocumentApproval">) {
  const { me, data, today, recordDocumentApproval } = useClub();
  const version = (data.documentVersions ?? []).find(
    (v) => v.id === route.params.versionId,
  );
  const doc =
    version && (data.documents ?? []).find((d) => d.id === version.documentId);
  const approval = useApproval(doc ? defaultBody(doc) : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  if (!version || !doc) {
    return (
      <Screen>
        <Notice tone="warn">{NO_VERSION}</Notice>
      </Screen>
    );
  }
  const ready =
    approval.value.approvingBody !== null &&
    approval.value.approvedOn !== null &&
    approval.value.commencesOn !== null;
  const record = async () => {
    if (saving) return;
    setError(null);
    const problem = recordApprovalProblem(
      me,
      version.id,
      approval.value,
      data,
      today,
    );
    if (problem) return setError(problem);
    setSaving(true);
    try {
      await recordDocumentApproval(version.id, approval.value);
      navigation.goBack();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };
  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>{doc.title}</H1>
        <Body>{`Record who approved ${version.label}, when, and when it takes effect. Once it has commenced, it’s the version in force.`}</Body>
      </Stack>
      <Card>
        <ApprovalFields a={approval} />
      </Card>
      <Stack gap={space.sm}>
        {saving ? (
          <Button label="Recording" busy onPress={() => {}} />
        ) : (
          <ConfirmButton
            label="Record approval"
            confirmLabel="Yes, record it"
            confirmNote="It can’t be changed afterwards. A mistake needs a new version."
            kind="primary"
            icon="checkmark-done-outline"
            disabled={!ready || approval.bad}
            onConfirm={record}
          />
        )}
        <View accessibilityLiveRegion="polite" role="alert">
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </View>
      </Stack>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Who's signed
// ---------------------------------------------------------------------------

export function DocumentSignoffsScreen({
  route,
  navigation,
}: RootScreen<"DocumentSignoffs">) {
  const { me, data, today } = useClub();
  const doc = (data.documents ?? []).find((d) => d.id === route.params.id);
  if (!me) return null;
  if (!doc || !publishesDocument(me, doc.chapterId, data.positions)) {
    return (
      <Screen>
        <Notice tone="warn">
          Only the document’s publishers can see who’s signed.
        </Notice>
      </Screen>
    );
  }
  const current = inForce(doc, data, today);
  const asked = askedToSignDocument(doc, data);
  const signed = asked.filter(
    (m) => signStatus(m, doc, data, today) === "signed",
  );
  const notSigned = asked.filter(
    (m) => signStatus(m, doc, data, today) !== "signed",
  );
  const open = (memberId: string) =>
    navigation.navigate("MemberDetail", { memberId });
  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>{doc.title}</H1>
        <Text style={styles.countLine} accessibilityLiveRegion="polite">
          {current
            ? `${signed.length} of ${asked.length} signed · ${current.label}`
            : "Nothing in force to sign yet"}
        </Text>
      </Stack>
      {current ? (
        <>
          <SignGroup
            title="Not signed"
            members={notSigned}
            doc={doc}
            onMember={open}
          />
          <SignGroup
            title="Signed"
            members={signed}
            doc={doc}
            onMember={open}
          />
        </>
      ) : null}
    </Screen>
  );
}

function SignGroup({
  title,
  members,
  doc,
  onMember,
}: {
  title: string;
  members: Member[];
  doc: ClubDocument;
  onMember: (id: string) => void;
}) {
  const { data, today } = useClub();
  return (
    <Stack gap={space.sm}>
      <SectionTitle
        title={title}
        action={<Text style={styles.groupCount}>{members.length}</Text>}
      />
      <Card style={{ padding: 0, gap: 0 }}>
        {members.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>Nobody.</Small>
          </View>
        ) : (
          members.map((m, i) => {
            const s = countingSignoff(m, doc, data, today);
            return (
              <ListRow
                key={m.id}
                last={i === members.length - 1}
                title={displayName(m)}
                subtitle={
                  s ? (
                    <Text
                      style={styles.rowMeta}
                    >{`Signed ${formatAuDate(melbourneDate(s.signedAt))}`}</Text>
                  ) : undefined
                }
                onPress={() => onMember(m.id)}
              />
            );
          })
        )}
      </Card>
    </Stack>
  );
}

const styles = StyleSheet.create({
  rowMeta: {
    fontFamily: fonts.stencil,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.3,
    color: colors.boneDim,
  },
  changes: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.steel,
  },
  changesLabel: {
    fontFamily: fonts.stencil,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.6,
    color: colors.bone,
    textTransform: "uppercase",
  },
  changesText: { ...type.body, color: colors.bone },
  text: { gap: space.md, paddingVertical: space.xl },
  heading: {
    fontFamily: fonts.stencil,
    fontSize: 19,
    lineHeight: 26,
    letterSpacing: 0.6,
    color: colors.bone,
  },
  prose: {
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 25,
    color: colors.boneDim,
  },
  bullet: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  bulletMark: {
    width: 6,
    height: 6,
    marginTop: 10,
    marginLeft: space.xs,
    backgroundColor: colors.boneMute,
    borderRadius: 1,
  },
  // A jumped-to block: lifted onto steel, padded out so the text doesn't move.
  lit: {
    backgroundColor: colors.steel,
    borderRadius: radius.sm,
    marginHorizontal: -space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    marginVertical: -space.xs,
  },
  hitsHead: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
  hitText: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.boneDim,
  },
  contentsHead: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  contentsTitle: {
    fontFamily: fonts.stencil,
    fontSize: 16,
    letterSpacing: 0.6,
    color: colors.bone,
    flex: 1,
    textTransform: "uppercase",
  },
  contentsItem: {
    fontFamily: fonts.stencil,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: 0.3,
    color: colors.bone,
  },
  signBox: { gap: space.lg, paddingVertical: space.xl },
  pledge: {
    fontFamily: fonts.stencil,
    fontSize: 19,
    lineHeight: 26,
    letterSpacing: 0.4,
    color: colors.bone,
  },
  signedRow: { gap: space.sm, alignItems: "flex-start", flexWrap: "nowrap" },
  signedText: {
    fontFamily: fonts.stencil,
    fontSize: 17,
    lineHeight: 24,
    letterSpacing: 0.4,
    flex: 1,
    color: colors.bone,
  },
  signButton: { minHeight: 64 },
  signAgain: { alignSelf: "flex-start", marginLeft: -space.lg },
  reviewLine: {
    fontFamily: fonts.stencil,
    fontSize: 17,
    lineHeight: 24,
    letterSpacing: 0.4,
    color: colors.bone,
  },
  bodyInput: { minHeight: 320 },
  count: {
    fontFamily: fonts.stencil,
    fontSize: 13,
    letterSpacing: 0.3,
    color: colors.boneDim,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  countLine: {
    fontFamily: fonts.stencil,
    fontSize: 19,
    lineHeight: 26,
    letterSpacing: 0.4,
    color: colors.bone,
  },
  groupCount: {
    fontFamily: fonts.stencil,
    fontSize: 16,
    color: colors.boneMute,
  },
});
