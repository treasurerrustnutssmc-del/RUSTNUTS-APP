// Report what another member posted (a listing, a build update, a nomination, a workshop, a
// profile): a quiet Report button that opens an optional reason and Send report, then the note
// the rules promise. Once sent, the thing disappears from the reporter's own view until the board
// deals with it (src/domain/reports.ts).

import React, { useState } from 'react';
import { View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { useSocial } from '../data/social/SocialProvider';
import { REPORT_KIND_LABEL, REPORTED_NOTE, reportedByMe, type ReportKind } from '../domain/reports';
import { space } from '../theme';
import { Button, Field, Notice, Row, Stack } from './primitives';

export function ReportBox({ kind, targetId, authorId }: { kind: ReportKind; targetId: string; authorId: string | null }) {
  const { me } = useClub();
  const { myOpenReports, reportContent } = useSocial();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (!me || me.approval !== 'approved' || me.status === 'family' || authorId === me.id) return null;
  if (done || reportedByMe(kind, targetId, myOpenReports)) return <Notice tone="info">{REPORTED_NOTE}</Notice>;
  const what = REPORT_KIND_LABEL[kind].toLowerCase();
  const send = () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    reportContent(kind, targetId, reason)
      .then(() => setDone(true))
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  if (!open) {
    return (
      <View style={{ alignItems: 'flex-start' }}>
        <Button
          label="Report"
          kind="quiet"
          size="small"
          icon="flag-outline"
          accessibilityLabel={`Report this ${what}`}
          onPress={() => setOpen(true)}
        />
      </View>
    );
  }
  return (
    <Stack gap={space.sm}>
      <Field label={`What’s wrong with this ${what}? (optional)`} value={reason} onChangeText={setReason} maxLength={500} multiline />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Row style={{ gap: space.sm }}>
        <Button label="Send report" kind="secondary" icon="flag-outline" busy={busy} onPress={send} />
        <Button label="Cancel" kind="quiet" onPress={() => setOpen(false)} />
      </Row>
    </Stack>
  );
}
