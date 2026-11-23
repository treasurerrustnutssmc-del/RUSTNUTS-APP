// Board files (spec docs/superpowers/specs/2026-11-24-board-files-design.md): the club's paperwork,
// kept by seat. Board › Board files lists Club info, every chapter's board seats and the national
// seats; a folder lists its files, opens them, and lets whoever does that seat's duties add and
// remove them. Board members of every chapter and the NEC read every folder.

import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { pickBoardFile, pickBoardPhoto, type PickedBoardUpload } from '../data/boardFilePick';
import {
  boardFileKind, boardFolders, folderFiles, folderLabel, formatBytes, isBoardFolder, readsBoardFiles, seatHolder, writesBoardFolder,
  type BoardFolderRef,
} from '../domain/boardFiles';
import { formatAuDate } from '../domain/dates';
import { ROLE_LABEL } from '../domain/labels';
import { displayName, FORMER_MEMBER } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import type { BoardFile } from '../domain/types';
import type { RootScreen, RootParams } from '../navigation/types';
import { colors, space } from '../theme';
import { Body, Button, Card, ConfirmButton, IconBadge, ListRow, Notice, Row, Screen, SectionTitle, Small, Stack } from '../ui/primitives';
import { openLink } from '../ui/openLink';

type Nav = NavigationProp<RootParams>;
type IconName = React.ComponentProps<typeof Ionicons>['name'];

const plural = (n: number) => (n === 0 ? 'No files yet' : n === 1 ? '1 file' : `${n} files`);

/** The Board tab's row, for board members and the NEC. */
export function BoardFilesRow({ last }: { last?: boolean }) {
  const { me, data } = useClub();
  const navigation = useNavigation<Nav>();
  if (!readsBoardFiles(me, data.positions)) return null;
  return (
    <ListRow
      last={last}
      left={<IconBadge icon="folder-open-outline" />}
      title="Board files"
      subtitle="A folder for every seat, and Club info"
      onPress={() => navigation.navigate('BoardFiles')}
    />
  );
}

export function BoardFilesScreen({ navigation }: RootScreen<'BoardFiles'>) {
  const { me, data, isDemo, refresh } = useClub();
  if (!me) return null;
  if (!readsBoardFiles(me, data.positions)) {
    return (
      <Screen>
        <Notice title="Board members only">Board files are for board members and the NEC.</Notice>
      </Screen>
    );
  }
  const folders = boardFolders(me, data);
  const sections = [...new Set(folders.map((f) => f.section))];
  return (
    <Screen onRefresh={isDemo ? undefined : refresh}>
      <Body>
        Files belong to the seat, not the person. Whoever takes on a seat finds its folder ready, and every board member
        and the NEC can open them all.
      </Body>
      {sections.map((section) => {
        const rows = folders.filter((f) => f.section === section);
        return (
          <Stack key={section} gap={space.sm}>
            <SectionTitle title={section} />
            <Card style={{ padding: 0, gap: 0 }}>
              {rows.map((f, i) => (
                <ListRow
                  key={f.key}
                  last={i === rows.length - 1}
                  left={<IconBadge icon={f.role === null ? 'briefcase-outline' : f.count > 0 ? 'folder-outline' : 'folder-open-outline'} />}
                  title={f.title}
                  subtitle={f.role === null ? `Business details, insurance, certificates · ${plural(f.count)}` : `${f.holder ?? 'Vacant'} · ${plural(f.count)}`}
                  accessibilityLabel={`${folderLabel(f, data)}, ${f.role === null ? '' : `${f.holder ?? 'vacant'}, `}${plural(f.count)}`}
                  onPress={() => navigation.navigate('BoardFolder', { chapterId: f.chapterId, role: f.role })}
                />
              ))}
            </Card>
          </Stack>
        );
      })}
    </Screen>
  );
}

const KIND_ICON: Record<string, IconName> = {
  PDF: 'document-text-outline', Photo: 'image-outline', Word: 'document-outline', Excel: 'grid-outline',
  Spreadsheet: 'grid-outline', Text: 'reader-outline',
};

function fileLine(f: BoardFile, who: string): string {
  const kind = boardFileKind(f.name, null)?.label ?? 'File';
  return [kind, formatBytes(f.sizeBytes), formatAuDate(melbourneDate(f.addedAt)), who].filter(Boolean).join(' · ');
}

export function BoardFolderScreen({ route, navigation }: RootScreen<'BoardFolder'>) {
  const { me, data, isDemo, refresh, addBoardFile, removeBoardFile, boardFileUrl } = useClub();
  const folder: BoardFolderRef = { chapterId: route.params.chapterId ?? null, role: route.params.role ?? null };
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState<'file' | 'photo' | string | null>(null);
  const [tidying, setTidying] = useState(false);
  const title = folderLabel(folder, data);
  React.useLayoutEffect(() => navigation.setOptions({ title }), [navigation, title]);
  if (!me) return null;
  if (!readsBoardFiles(me, data.positions) || !isBoardFolder(folder, data)) {
    return (
      <Screen>
        <Notice title="Not here">Board files are for board members and the NEC.</Notice>
      </Screen>
    );
  }
  const files = folderFiles(folder, data);
  if (tidying && files.length === 0) setTidying(false);
  const writer = writesBoardFolder(me, folder, data);
  const holder = seatHolder(folder, data);
  const nameOf = (id: string | null) => {
    if (!id) return FORMER_MEMBER;
    const m = data.members.find((x) => x.id === id);
    return m ? displayName(m) : FORMER_MEMBER;
  };
  const fail = (e: unknown) => setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'That didn’t work. Try again.' });

  const add = async (which: 'file' | 'photo') => {
    if (busy) return;
    setMsg(null);
    // Busy from the tap, so a second tap can't open a second picker (iOS refuses that). On the web a
    // backed-out chooser may never report, so the web build frees the button once it's open.
    setBusy(which);
    try {
      const picking: Promise<PickedBoardUpload | null> = which === 'file' ? pickBoardFile() : pickBoardPhoto();
      if (Platform.OS === 'web') setBusy(null);
      const file = await picking;
      if (!file) return;
      setBusy(which);
      await addBoardFile(folder, file);
      setMsg({ tone: 'ok', text: 'Added to this folder.' });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const open = async (f: BoardFile) => {
    if (busy) return;
    setBusy(f.id);
    setMsg(null);
    // The web build opens the tab during the tap (browsers block one opened after a wait) and points
    // it at the signed address once it comes back. Phones use the in-app browser sheet.
    const tab = Platform.OS === 'web' ? window.open('', '_blank') : null;
    try {
      const url = await boardFileUrl(f.path);
      if (tab) tab.location.href = url;
      else await openLink(url);
    } catch (e) {
      tab?.close();
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const who =
    folder.role === null
      ? writer ? 'Any board member or the NEC can add and remove files here.' : null
      : writer
        ? 'You can add and remove files here. They stay with the seat when it changes hands.'
        : `Only the ${ROLE_LABEL[folder.role]} or the National Chairman or Secretary can add or remove files here.`;

  return (
    <Screen onRefresh={isDemo ? undefined : refresh}>
      <Stack gap={space.xs}>
        {folder.role !== null ? <Body strong>{holder ? `${ROLE_LABEL[folder.role]}: ${holder}` : 'This seat is vacant.'}</Body> : null}
        {who ? <Small>{who}</Small> : null}
      </Stack>

      {msg ? (
        <Notice tone={msg.tone} notAnError={msg.tone === 'ok'}>
          {msg.text}
        </Notice>
      ) : null}

      {writer ? (
        <Stack gap={space.sm}>
          <Row style={{ gap: space.sm }}>
            <Button style={{ flex: 1 }} label="Add file" icon="attach-outline" busy={busy === 'file'} disabled={!!busy} onPress={() => add('file')} />
            <Button
              style={{ flex: 1 }} label="Add photo" kind="secondary" icon="image-outline" busy={busy === 'photo'} disabled={!!busy}
              onPress={() => add('photo')}
            />
          </Row>
          <Small>PDF, photo, Word, Excel or text, up to 20 MB each.</Small>
        </Stack>
      ) : null}

      <Stack gap={space.sm}>
        <SectionTitle
          title="Files"
          action={writer && files.length > 0 ? (
            <Button size="small" kind="quiet" label={tidying ? 'Done' : 'Remove files'} onPress={() => setTidying((t) => !t)} />
          ) : undefined}
        />
        {files.length === 0 ? (
          <Card>
            <Small>{writer ? 'Nothing here yet. Add what the next person in this seat will need.' : 'Nothing here yet.'}</Small>
          </Card>
        ) : (
          <Card style={{ padding: 0, gap: 0 }}>
            {files.map((f, i) => {
              const kind = boardFileKind(f.name, null)?.label ?? 'File';
              const icon = KIND_ICON[kind] ?? 'document-outline';
              return tidying ? (
                <View key={f.id} style={{ borderBottomWidth: i === files.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
                  <ListRow last left={<IconBadge icon={icon} />} title={f.name} subtitle={fileLine(f, nameOf(f.addedBy))} />
                  <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
                    <ConfirmButton
                      size="small"
                      label="Remove"
                      accessibilityLabel={`Remove ${f.name}`}
                      confirmLabel="Remove it"
                      confirmAccessibilityLabel={`Yes, remove ${f.name}`}
                      confirmNote="It comes out of this folder for everyone."
                      icon="trash-outline"
                      onConfirm={() => removeBoardFile(f.id).then(() => setMsg({ tone: 'ok', text: `Removed ${f.name}.` }), fail)}
                    />
                  </View>
                </View>
              ) : (
                <ListRow
                  key={f.id}
                  last={i === files.length - 1}
                  left={<IconBadge icon={icon} />}
                  title={f.name}
                  subtitle={fileLine(f, nameOf(f.addedBy))}
                  accessibilityLabel={`Open ${f.name}, ${fileLine(f, nameOf(f.addedBy))}`}
                  right={busy === f.id ? <Small>Opening…</Small> : undefined}
                  onPress={() => open(f)}
                />
              );
            })}
          </Card>
        )}
      </Stack>
    </Screen>
  );
}
