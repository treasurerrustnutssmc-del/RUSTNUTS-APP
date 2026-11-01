import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useEnquiries } from '../data/enquiries';
import { useClub } from '../data/ClubStore';
import { formatAuDate } from '../domain/dates';
import { enquiryChapterLabel, mailtoFor, type Enquiry } from '../domain/enquiries';
import { melbourneDate } from '../domain/rides';
import { isAnyBoard } from '../domain/social/help';
import { Body, Button, Card, Chip, ConfirmButton, Field, KeyValue, Notice, Row, SectionTitle, Small, Stack } from '../ui/primitives';
import { colors, space, type } from '../theme';

/**
 * "Website enquiries" on the Board screen: people who filled in the club website's Ride With Us
 * form. The board emails them back from their own mail app and ticks each one off with a note.
 */
export function WebsiteEnquiries({ onDone }: { onDone: (msg: string) => void }) {
  const { me, data } = useClub();
  const { ready, enquiries, loadError, handle } = useEnquiries();
  if (!isAnyBoard(me, data.positions)) return null;
  const open = enquiries.filter((e) => e.handledAt === null);
  return (
    <>
      <SectionTitle title="Website enquiries" action={<Small>{open.length}</Small>} />
      {loadError ? (
        <Notice tone="danger">{loadError}</Notice>
      ) : !ready ? (
        <Card>
          <Small>Loading…</Small>
        </Card>
      ) : enquiries.length === 0 ? (
        <Card>
          <Small>Nobody has asked through the website yet. Ride With Us enquiries land here.</Small>
        </Card>
      ) : (
        enquiries.map((e) => <EnquiryCard key={e.id} enquiry={e} onDone={onDone} handle={handle} />)
      )}
    </>
  );
}

function EnquiryCard({ enquiry, onDone, handle }: { enquiry: Enquiry; onDone: (msg: string) => void; handle: (id: string, note: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = enquiry.handledAt !== null;

  const email = () => {
    setError(null);
    Linking.openURL(mailtoFor(enquiry)).catch(() => setError(`This device can’t open mail from here. Write to ${enquiry.email}.`));
  };
  const markHandled = async () => {
    setBusy(true);
    setError(null);
    try {
      await handle(enquiry.id, note);
      onDone(`${enquiry.name}’s enquiry is handled.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={done ? { opacity: 0.7 } : undefined}>
      <Row style={{ gap: space.md, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.name}>{enquiry.name}</Text>
          <Small>{enquiry.email} · {formatAuDate(melbourneDate(enquiry.createdAt))}</Small>
        </View>
        <Chip label={enquiryChapterLabel(enquiry.chapter)} tone={enquiry.chapter === 'either' ? 'bone' : 'steel'} />
      </Row>
      {enquiry.about ? (
        <View style={{ borderLeftWidth: 2, borderLeftColor: colors.lineStrong, paddingLeft: space.md }}>
          <Body>“{enquiry.about}”</Body>
        </View>
      ) : null}
      {done ? (
        <Stack gap={2}>
          <KeyValue label="Handled" value={formatAuDate(melbourneDate(enquiry.handledAt!))} tone="ok" />
          {enquiry.note ? <KeyValue label="Note" value={enquiry.note} /> : null}
        </Stack>
      ) : (
        <>
          <Field label="Note" value={note} onChangeText={setNote} multiline maxLength={300} hint="What you did, for the rest of the board." />
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Row style={{ gap: space.sm }}>
            <Button label="Email" icon="mail" style={{ flex: 1 }} onPress={email} accessibilityLabel={`Email ${enquiry.name}`} />
          </Row>
          <ConfirmButton
            label="Handled"
            confirmLabel="Yes, handled"
            kind="secondary"
            icon="checkmark"
            disabled={busy}
            onConfirm={() => void markHandled()}
            accessibilityLabel={`Mark ${enquiry.name}’s enquiry handled`}
          />
        </>
      )}
    </Card>
  );
}
