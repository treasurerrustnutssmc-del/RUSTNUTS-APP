// Club spending (Jeff, 21 Nov 2026): every expense the club has paid this financial year, so members
// can see where the money goes. Member names are taken out (Jeff chose "Hide member names"). The
// same readers as the Treasurer's Reports: approved members who haven't left, never Family.

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { spendingByCode, spendingFor, spendingMonths, spendingTotal, spendingYears } from '../domain/clubSpending';
import { formatAuDate } from '../domain/dates';
import { PRIVACY_LINE } from '../domain/financePrivacy';
import { formatCents, fyLabel } from '../domain/fees';
import { fundName, seesReports } from '../domain/ledger';
import { monthName } from '../domain/meetingReport';
import { STATEMENT_LABEL } from '../domain/meetingStatement';
import type { RootScreen } from '../navigation/types';
import { colors, space, type } from '../theme';
import { Card, Choices, Divider, H1, H2, ListRow, Notice, PrivacyLine, Row, Screen, SectionTitle, Small, Stack } from '../ui/primitives';

const num = { fontVariant: ['tabular-nums' as const] };

export function ClubSpendingScreen(_: RootScreen<'ClubSpending'>) {
  const { me, data, today } = useClub();
  const years = spendingYears(today);
  const [fy, setFy] = useState(String(years[0]));
  if (!seesReports(me)) {
    return (
      <Screen>
        <Notice tone="info">Club spending is for members.</Notice>
      </Screen>
    );
  }
  const lines = spendingFor(data, Number(fy));
  const total = spendingTotal(lines);
  const kinds = spendingByCode(lines);
  const months = spendingMonths(lines);

  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>Club spending</H1>
        <Small>Every expense paid from the club’s bank account, from the treasurer’s books.</Small>
      </Stack>
      <PrivacyLine text={PRIVACY_LINE} />

      <Choices<string>
        label="Financial year (1 July to 30 June)"
        options={years.map((y) => ({ value: String(y), label: fyLabel(y) }))}
        value={fy}
        onChange={setFy}
      />

      <Card>
        <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: space.md, flexWrap: 'nowrap' }}>
          <H2 style={{ flexShrink: 1 }}>Total spent</H2>
          <Text style={[type.h2, num]}>{formatCents(total)}</Text>
        </Row>
        {kinds.length === 0 ? <Small>No expenses paid this year yet.</Small> : null}
        {kinds.length > 0 ? <Divider /> : null}
        {kinds.map((k) => (
          <Row key={k.code} style={{ justifyContent: 'space-between', gap: space.md, flexWrap: 'nowrap' }}>
            <Text style={[type.body, { flexShrink: 1 }]}>{STATEMENT_LABEL[k.code] ?? k.code}</Text>
            <Text style={[type.name, num, { color: colors.boneDim }]}>{formatCents(k.cents)}</Text>
          </Row>
        ))}
      </Card>

      {months.map((m) => (
        <View key={m.month} style={{ gap: space.sm }}>
          <SectionTitle
            title={`${monthName(`${m.month}-01`)} ${m.month.slice(0, 4)}`}
            action={<Text style={[type.name, num, { color: colors.boneDim }]}>{formatCents(spendingTotal(m.lines))}</Text>}
          />
          <Card style={{ padding: 0, gap: 0 }}>
            {m.lines.map((l, i) => (
              <ListRow
                key={l.id}
                last={i === m.lines.length - 1}
                lines="all"
                title={l.description.trim() || STATEMENT_LABEL[l.code]}
                subtitle={[
                  formatAuDate(l.entryOn),
                  STATEMENT_LABEL[l.code],
                  `${fundName(l.chapterId, data)} fund`,
                  l.payee ? `paid to ${l.payee}` : null,
                ].filter(Boolean).join(' · ')}
                right={<Text style={[type.name, num]}>{formatCents(l.amountCents)}</Text>}
              />
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}
