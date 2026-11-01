import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { useSiteNews } from '../data/siteNews';
import { formatAuDate } from '../domain/dates';
import { melbourneDate } from '../domain/rides';
import { NEWS_BODY_MAX, NEWS_DAYS, NEWS_LINK_MAX, NEWS_SHOWN, NEWS_TITLE_MAX, type SiteNews } from '../domain/siteNews';
import { isAnyBoard } from '../domain/social/help';
import { openLink } from '../ui/openLink';
import { Body, Button, Card, Chip, ConfirmButton, Field, KeyValue, Notice, Row, SectionTitle, Small, Stack } from '../ui/primitives';
import { space, type } from '../theme';

/**
 * "Club news for the website" on the Board screen: the board writes a short notice and the club
 * website's home page shows the newest few. Spec: docs/superpowers/specs/2026-11-01-website-news-design.md
 */
export function WebsiteNews({ onDone }: { onDone: (msg: string) => void }) {
  const { me, data } = useClub();
  const { ready, news, loadError, post, remove } = useSiteNews();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!isAnyBoard(me, data.positions)) return null;
  const live = news.filter((n) => n.removedAt === null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await post({ title, body, link });
      setTitle('');
      setBody('');
      setLink('');
      onDone('Posted. The website shows it within a few minutes.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle title="Club news for the website" action={<Small>{live.length}</Small>} />
      <Card>
        <Small>
          Public notices for the club website’s home page: an open day, a toy run, a change of venue. The newest {NEWS_SHOWN} show
          for {NEWS_DAYS} days, or until you take them down. No names go with them.
        </Small>
        <Field label="Title" value={title} onChangeText={setTitle} maxLength={NEWS_TITLE_MAX} placeholder="Toy run, Sunday 7 December" />
        <Field
          label="Notice"
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={NEWS_BODY_MAX}
          hint={`${body.length}/${NEWS_BODY_MAX}. Written for the public, not for members.`}
        />
        <Field
          label="Link (optional)"
          value={link}
          onChangeText={setLink}
          maxLength={NEWS_LINK_MAX}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://"
          hint="Shown as “More”. Must start with https://."
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button label="Post to the website" icon="globe-outline" onPress={() => void send()} disabled={busy || !title.trim() || !body.trim()} busy={busy} />
      </Card>
      {loadError ? (
        <Notice tone="danger">{loadError}</Notice>
      ) : !ready ? (
        <Card>
          <Small>Loading…</Small>
        </Card>
      ) : news.length === 0 ? (
        <Card>
          <Small>Nothing posted yet. The website’s news strip stays hidden until there is.</Small>
        </Card>
      ) : (
        news.map((n) => <NewsCard key={n.id} notice={n} onDone={onDone} remove={remove} />)
      )}
    </>
  );
}

function NewsCard({ notice, onDone, remove }: { notice: SiteNews; onDone: (msg: string) => void; remove: (id: string) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const down = notice.removedAt !== null;

  const takeDown = async () => {
    setBusy(true);
    setError(null);
    try {
      await remove(notice.id);
      onDone(`“${notice.title}” is off the website.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={down ? { opacity: 0.7 } : undefined}>
      <Row style={{ gap: space.md, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.name}>{notice.title}</Text>
          <Small>Posted {formatAuDate(melbourneDate(notice.createdAt))}</Small>
        </View>
        <Chip label={down ? 'Taken down' : 'On the website'} tone={down ? 'bone' : 'steel'} />
      </Row>
      <Body>{notice.body}</Body>
      {notice.link ? (
        <Row style={{ gap: space.sm }}>
          <Button label="More" kind="secondary" icon="open-outline" style={{ flex: 1 }} onPress={() => openLink(notice.link!).catch(() => {})} accessibilityLabel={`Open the link for ${notice.title}`} />
        </Row>
      ) : null}
      {down ? (
        <Stack gap={2}>
          <KeyValue label="Taken down" value={formatAuDate(melbourneDate(notice.removedAt!))} />
        </Stack>
      ) : (
        <>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <ConfirmButton
            label="Take down"
            confirmLabel="Yes, take it down"
            kind="secondary"
            icon="eye-off-outline"
            disabled={busy}
            onConfirm={() => void takeDown()}
            accessibilityLabel={`Take “${notice.title}” off the website`}
          />
        </>
      )}
    </Card>
  );
}
