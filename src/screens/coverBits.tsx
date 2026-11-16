// Cover while I'm away (acting roles): the panels on Me, the covered notice on Home, and a
// stand-in's request on Me for someone with no Board tab. The words and what shows come from
// meLayout (coverPanels, homeCoverPanels, standInPanels); these draw them and wire each button.
import React, { useState } from 'react';
import { useClub } from '../data/ClubStore';
import { requestCoverProblem, WHY_NEEDED } from '../domain/access';
import { coverConfirmNote, coverUntilError, type CoverPanel, type StandInPanel } from '../domain/meLayout';
import { displayName } from '../domain/profile';
import { colors } from '../theme';
import { useToast } from '../ui/Toast';
import { Body, Card, Choices, ConfirmButton, Disclosure, Field, Notice, SectionTitle, Small } from '../ui/primitives';
import { DateField, useDate } from './adminBits';

/** Each of the viewer's board seats, as coverPanels lays it out: covered, asked for, or to arrange. */
export function CoverPanels({ panels }: { panels: CoverPanel[] }) {
  return (
    <>
      {panels.map((panel) =>
        panel.kind === 'covered' ? (
          <CoveredSeat key={panel.seat.id} panel={panel} />
        ) : panel.kind === 'asked' ? (
          <AskedCover key={panel.seat.id} panel={panel} />
        ) : panel.kind === 'arrange' ? (
          <ArrangeCover key={panel.seat.id} panel={panel} />
        ) : (
          <BlockedCover key={panel.seat.id} panel={panel} />
        ),
      )}
    </>
  );
}

/** The covered holder: who is acting, what they do meanwhile, and "I'm back" to end it (holder_back). */
function CoveredSeat({ panel }: { panel: Extract<CoverPanel, { kind: 'covered' }> }) {
  const { endPosition } = useClub();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <SectionTitle title={panel.title} />
      <Card>
        <Body>{panel.notice}</Body>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <ConfirmButton
          label={panel.button.label}
          confirmLabel={panel.button.confirmLabel}
          confirmNote={panel.button.confirmNote}
          kind="secondary"
          onConfirm={() => {
            setError(null);
            endPosition(panel.cover.id)
              .then(() => toast('You’re back in the seat'))
              .catch((e: Error) => setError(e.message));
          }}
        />
      </Card>
    </>
  );
}

/** A request to cover the viewer's seat, waiting for a third board member (or a vote): theirs to withdraw. */
function AskedCover({ panel }: { panel: Extract<CoverPanel, { kind: 'asked' }> }) {
  const { withdrawActingRequest } = useClub();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <SectionTitle title={panel.title} />
      <Card>
        <Body>{panel.line}</Body>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <ConfirmButton
          label={panel.button.label}
          confirmLabel={panel.button.confirmLabel}
          confirmAccessibilityLabel="Yes, withdraw the cover request"
          confirmNote={panel.button.confirmNote}
          kind="secondary"
          onConfirm={() => {
            setError(null);
            withdrawActingRequest(panel.request.id)
              .then(() => toast('Request withdrawn'))
              .catch((e: Error) => setError(e.message));
          }}
        />
      </Card>
    </>
  );
}

/**
 * Arranging a cover of the viewer's own seat (route 2): pick the stand-in, the last acting day and
 * why. Nothing moves until a third board member confirms it on the Board tab.
 */
function ArrangeCover({ panel }: { panel: Extract<CoverPanel, { kind: 'arrange' }> }) {
  const { me, data, today, requestCover } = useClub();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [standInId, setStandInId] = useState<string | null>(panel.choices[0]?.value ?? null);
  const until = useDate(panel.until);
  const [why, setWhy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const standIn = data.members.find((m) => m.id === standInId) ?? null;
  const problem = !standIn
    ? 'Pick who stands in.'
    : until.error || !until.iso
      ? null
      : requestCoverProblem(me, panel.seat, standIn, until.iso, why, data, today);
  // A date the rule refuses shows on Until. The why's own words wait until something is typed:
  // its hint already says it's required.
  const untilShown = coverUntilError(problem, panel.cap);
  const shown = untilShown !== null || (problem === WHY_NEEDED && !why.trim()) ? null : problem;
  const ready = !!standIn && !!until.iso && !until.error && problem === null;
  return (
    <Disclosure title={panel.title} summary={panel.summary} open={open} onToggle={() => setOpen((o) => !o)}>
      <Card>
        <Choices<string> label="Who stands in" options={panel.choices} value={standInId} onChange={setStandInId} />
        <DateField label="Until" date={until} hint={panel.untilHint} error={untilShown} />
        <Field
          label="Why"
          value={why}
          onChangeText={setWhy}
          maxLength={120}
          placeholder="Overseas until mid-December"
          hint={panel.whyHint}
        />
        {shown ? <Small style={{ color: colors.danger }}>{shown}</Small> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <ConfirmButton
          label={busy ? 'Asking…' : 'Ask for cover'}
          confirmLabel="Yes, ask"
          confirmAccessibilityLabel={standIn ? `Yes, ask for ${displayName(standIn)} to cover` : undefined}
          confirmNote={standIn && ready ? coverConfirmNote(panel.seat, standIn, until.iso, data, today) : undefined}
          kind="primary"
          disabled={!ready || busy}
          onConfirm={() => {
            if (!standIn) return;
            setError(null);
            setBusy(true);
            requestCover(panel.seat.id, standIn.id, until.iso, why.trim())
              .then(() => toast(`Asked for ${displayName(standIn)} to cover`))
              .catch((e: Error) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        />
      </Card>
    </Disclosure>
  );
}

/** A seat that can't be covered in the app now, and why (a board too small to decide it: refer it to the NEC, 8.6). */
function BlockedCover({ panel }: { panel: Extract<CoverPanel, { kind: 'blocked' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <Disclosure title={panel.title} summary={panel.summary} open={open} onToggle={() => setOpen((o) => !o)}>
      <Card>
        <Body>{panel.line}</Body>
      </Card>
    </Disclosure>
  );
}

/** Me, for a stand-in with no Board tab: each open request naming them, with Decline. */
export function StandInPanels({ panels }: { panels: StandInPanel[] }) {
  return (
    <>
      {panels.map((panel) => (
        <StandInRequest key={panel.request.id} panel={panel} />
      ))}
    </>
  );
}

/** One request for the viewer to act: who asked, the seat, until when and why, and Decline (withdraw_acting_request). */
function StandInRequest({ panel }: { panel: StandInPanel }) {
  const { withdrawActingRequest } = useClub();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <SectionTitle title={panel.title} />
      <Card>
        <Body>{panel.line}</Body>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <ConfirmButton
          label={panel.button.label}
          confirmLabel={panel.button.confirmLabel}
          confirmAccessibilityLabel="Yes, decline the request to act"
          confirmNote={panel.button.confirmNote}
          kind="secondary"
          onConfirm={() => {
            setError(null);
            withdrawActingRequest(panel.request.id)
              .then(() => toast('Declined. The request is closed.'))
              .catch((e: Error) => setError(e.message));
          }}
        />
      </Card>
    </>
  );
}
