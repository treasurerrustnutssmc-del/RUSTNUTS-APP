// Product pictures in the club shop: the picture on each garment (following the colour picked, front
// or back), the small one on a design's row, and the shop runners' picture editor on a design.
// Spec: docs/superpowers/specs/2026-11-02-shop-pictures-design.md.

import { Image } from 'expo-image';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { PickProblem, pickMedia } from '../data/chat/media';
import { SIDE_LABEL, SIDES, pictureGaps, picturesFor } from '../domain/shopPictures';
import type { ShopDesign, ShopGarment, ShopPicture, ShopPictureSide } from '../domain/types';
import { colors, radius, space, type } from '../theme';
import { Card, Choices, ConfirmButton, Notice, Row, SectionTitle, Small } from '../ui/primitives';
import { ActionWithReason, styles as adminStyles, useRun } from './adminBits';

const sideWord = (p: ShopPicture) => SIDE_LABEL[p.side].toLowerCase();

/** The garment's picture in the colour picked: front, with Front / Back to flip when there's a back. */
export function GarmentPictures({ garment, colour, designName }: { garment: ShopGarment; colour: string | null; designName: string }) {
  const { data } = useClub();
  const [side, setSide] = useState<ShopPictureSide>('front');
  const { pictures, ofThisGarment, ofThisColour } = picturesFor(data, garment, colour);
  if (pictures.length === 0) return null;
  const shown = pictures.find((p) => p.side === side) ?? pictures[0];
  const sides = SIDES.filter((s) => pictures.some((p) => p.side === s));
  const wanted = colour ?? garment.colours[0] ?? null;
  const notes = [
    !ofThisGarment ? `The ${designName} design, pictured on another garment.` : null,
    !ofThisColour && wanted ? `No ${wanted} picture yet: shown in ${shown.colour}.` : null,
  ].filter(Boolean);
  return (
    <View style={{ gap: space.sm }}>
      <Image
        source={{ uri: shown.url }}
        style={pictureStyles.picture}
        contentFit="cover"
        transition={150}
        accessibilityLabel={`${designName} ${garment.name}, ${sideWord(shown)}${shown.colour ? `, ${shown.colour}` : ''}`}
      />
      {sides.length > 1 ? (
        <Choices<ShopPictureSide> options={sides.map((s) => ({ value: s, label: SIDE_LABEL[s] }))} value={shown.side} onChange={setSide} />
      ) : null}
      {notes.length ? <Small>{notes.join(' ')}</Small> : null}
    </View>
  );
}

/** A design's first front picture, square, for its row in the shop. Null when it has none. */
export function designCover(pictures: ShopPicture[] | undefined, designId: string): ShopPicture | null {
  const mine = (pictures ?? []).filter((p) => p.designId === designId).sort((a, b) => a.sort - b.sort);
  return mine.find((p) => p.side === 'front' && p.garmentId === null) ?? mine.find((p) => p.side === 'front') ?? mine[0] ?? null;
}

export function DesignThumb({ picture, name }: { picture: ShopPicture; name: string }) {
  return <Image source={{ uri: picture.url }} style={pictureStyles.thumb} contentFit="cover" accessibilityLabel={`${name} design`} />;
}

// ---------------------------------------------------------------------------
// The shop runners' editor, on a design's screen
// ---------------------------------------------------------------------------

const ANY = '__any__';

function pictureLabel(p: ShopPicture, garments: ShopGarment[]): string {
  const who = p.garmentId ? garments.find((g) => g.id === p.garmentId)?.name ?? 'A garment' : 'Whole design';
  return `${who} · ${SIDE_LABEL[p.side]} · ${p.colour ?? 'Any colour'}`;
}

export function DesignPicturesEditor({ design, garments }: { design: ShopDesign; garments: ShopGarment[] }) {
  const { data, addShopPicture, removeShopPicture } = useClub();
  const [garmentId, setGarmentId] = useState<string>(ANY);
  const [colour, setColour] = useState<string>(ANY);
  const [side, setSide] = useState<ShopPictureSide>('front');
  const { busy, msg, run } = useRun();
  const [pickError, setPickError] = useState<string | null>(null);
  const pictures = (data.shopPictures ?? []).filter((p) => p.designId === design.id).sort((a, b) => a.sort - b.sort);
  const forGarment = garmentId === ANY ? null : garments.find((g) => g.id === garmentId) ?? null;
  const colours = [...new Set(forGarment ? forGarment.colours : garments.flatMap((g) => g.colours))];
  const gaps = pictureGaps(data).filter((g) => g.design.id === design.id);

  const add = async () => {
    setPickError(null);
    let picked;
    try {
      picked = await pickMedia('library', 1, true);
    } catch (e) {
      setPickError(e instanceof PickProblem ? e.message : 'That photo couldn’t be opened. Try another.');
      return;
    }
    if (!picked.length) return;
    const chosen = colour === ANY || !colours.includes(colour) ? null : colour;
    await run('add', () => addShopPicture({ designId: design.id, garmentId: forGarment?.id ?? null, colour: chosen, side }, picked[0]), 'Picture added.');
  };

  return (
    <>
      <SectionTitle title="Pictures" />
      <Small>A picture of the whole design shows on every garment. Add one for a single garment when you have a photo of it.</Small>
      {pictures.length === 0 ? <Notice tone="info">No pictures yet. Members see the garments without one.</Notice> : null}
      {pictures.map((p) => (
        <Card key={p.id}>
          <Row style={{ gap: space.md, alignItems: 'center' }}>
            <Image source={{ uri: p.url }} style={pictureStyles.thumb} contentFit="cover" accessibilityLabel={pictureLabel(p, garments)} />
            <Text style={[type.name, { flex: 1 }]}>{pictureLabel(p, garments)}</Text>
          </Row>
          <ConfirmButton
            label="Take it out"
            confirmLabel="Yes, take it out"
            kind="secondary"
            size="small"
            icon="trash-outline"
            accessibilityLabel={`Take out ${pictureLabel(p, garments)}`}
            onConfirm={() => run(`rm-${p.id}`, () => removeShopPicture(p.id), 'Picture taken out.')}
          />
        </Card>
      ))}
      <Card>
        <Text style={type.h2}>Add a picture</Text>
        <Choices<string>
          label="Of"
          options={[{ value: ANY, label: 'Whole design' }, ...garments.map((g) => ({ value: g.id, label: g.name }))]}
          value={garmentId}
          onChange={(v) => { setGarmentId(v); setColour(ANY); }}
        />
        {colours.length ? (
          <Choices<string>
            label="Colour"
            options={[{ value: ANY, label: 'Any colour' }, ...colours.map((c) => ({ value: c, label: c }))]}
            value={colour}
            onChange={setColour}
          />
        ) : null}
        <Choices<ShopPictureSide> label="Side" options={SIDES.map((s) => ({ value: s, label: SIDE_LABEL[s] }))} value={side} onChange={setSide} />
        <ActionWithReason label="Pick the photo" icon="image-outline" kind="secondary" busy={busy === 'add'} reason={pickError ?? (msg?.tone === 'danger' ? msg.text : null)} onPress={add} />
      </Card>
      {msg?.tone === 'ok' ? <Notice tone="ok">{msg.text}</Notice> : null}
      {gaps.length ? (
        <>
          <SectionTitle title="Still needs a picture" />
          <Card>
            {gaps.map((g) => (
              <Text key={`${g.garment.id}-${g.colour ?? ''}`} style={adminStyles.meta}>
                {`${g.garment.name}${g.colour ? ` in ${g.colour}` : ''}: ${g.missing === 'none' ? 'no picture' : 'only another colour'}`}
              </Text>
            ))}
          </Card>
        </>
      ) : null}
    </>
  );
}

const pictureStyles = StyleSheet.create({
  picture: { width: '100%', maxWidth: 360, aspectRatio: 1, alignSelf: 'center', borderRadius: radius.md, backgroundColor: colors.steel },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.steel },
});
