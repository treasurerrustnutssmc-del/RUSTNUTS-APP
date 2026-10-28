import React from 'react';
import { Linking } from 'react-native';
import { CLUB_LINK_GROUPS, SUPPORT_URL } from '../domain/clubLinks';
import { Card, IconBadge, ListRow, SectionTitle, type IconName } from '../ui/primitives';

/**
 * The club website, shop, podcast and socials. Each row opens outside the app.
 * The welcome screen already has its own Support card, so it passes withoutSupport.
 */
export function ClubLinksSection({ withoutSupport = false }: { withoutSupport?: boolean }) {
  const groups = CLUB_LINK_GROUPS.map((g) => ({
    ...g,
    links: withoutSupport ? g.links.filter((l) => l.url !== SUPPORT_URL) : g.links,
  }));
  return (
    <>
      {groups.map((group) => (
        <React.Fragment key={group.title}>
          <SectionTitle title={group.title} />
          <Card style={{ padding: 0, gap: 0 }}>
            {group.links.map((link, i) => (
              <ListRow
                key={link.url}
                last={i === group.links.length - 1}
                left={<IconBadge icon={link.icon as IconName} />}
                title={link.label}
                subtitle={link.detail}
                onPress={() => Linking.openURL(link.url)}
              />
            ))}
          </Card>
        </React.Fragment>
      ))}
    </>
  );
}
