import React from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { useSiteVisits } from '../data/siteVisits';
import { pageLabel, topPages, visitTotals } from '../domain/siteVisits';
import { isAnyBoard } from '../domain/social/help';
import { Card, Notice, Row, SectionTitle, Small } from '../ui/primitives';
import { colors, fonts, space, type } from '../theme';

/**
 * "Website visits" on the Board screen: page views counted per day per page by the club website,
 * nothing about the people. Spec: docs/superpowers/specs/2026-11-01-website-visits-design.md
 */
export function WebsiteVisits() {
  const { me, data, today } = useClub();
  const { ready, rows, loadError } = useSiteVisits();
  if (!isAnyBoard(me, data.positions)) return null;
  const totals = visitTotals(rows, today);
  const top = topPages(rows, today);
  return (
    <>
      <SectionTitle title="Website visits" />
      <Card>
        {loadError ? (
          <Notice tone="danger">{loadError}</Notice>
        ) : !ready ? (
          <Small>Loading…</Small>
        ) : (
          <>
            <Row style={{ gap: space.lg }}>
              <Figure label="Last 7 days" value={totals.week} />
              <Figure label="Last 30 days" value={totals.month} />
            </Row>
            {top.length === 0 ? (
              <Small>No page views counted yet. Each website page counts once per view, with nothing about the visitor.</Small>
            ) : (
              <View style={{ gap: 6 }}>
                {top.map((p) => (
                  <Row key={p.page} style={{ justifyContent: 'space-between' }}>
                    <Text style={type.body}>{pageLabel(p.page)}</Text>
                    <Text style={[type.name, { color: colors.bone }]}>{p.hits}</Text>
                  </Row>
                ))}
              </View>
            )}
            <Small>Page views on rustnutssmc.com.au, counted per day per page. No cookies, no addresses, nothing about who.</Small>
          </>
        )}
      </Card>
    </>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ fontFamily: fonts.stencil, fontSize: 28, color: colors.bone }}>{value}</Text>
      <Small>{label}</Small>
    </View>
  );
}
