import React from 'react';
import { GLOSSARY, roleKey } from '../domain/glossary';
import { Card, KeyValue, ListRow, Screen, SectionTitle, Small } from '../ui/primitives';

/** Club words: what the club's own words and the short role names on chips mean. */
export function ClubWordsScreen() {
  return (
    <Screen>
      <Small>What the club’s words mean. The wording is the club’s own, so tell the board if something is off.</Small>
      {GLOSSARY.map((group) => (
        <React.Fragment key={group.title}>
          <SectionTitle title={group.title} />
          <Card style={{ padding: 0, gap: 0 }}>
            {group.entries.map((e, i) => (
              <ListRow key={e.term} last={i === group.entries.length - 1} title={e.term} subtitle={<Small>{e.meaning}</Small>} />
            ))}
          </Card>
        </React.Fragment>
      ))}
      <SectionTitle title="Short role names" />
      <Small>On a member’s chip the bracket is their chapter, so SAA (WEST) is the West Sergeant at Arms.</Small>
      <Card>
        {roleKey().map((k) => (
          <KeyValue key={k.short} label={k.short} value={k.title} />
        ))}
      </Card>
    </Screen>
  );
}
