import React from 'react';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { RootParams } from '../navigation/types';
import { CLUB_LINK_GROUPS, SHOP_LINK_IDS } from '../domain/clubLinks';
import { Card, IconBadge, ListRow, SectionTitle, type IconName } from '../ui/primitives';
import { openLink } from '../ui/openLink';

/**
 * The club website, shop, podcast and socials. The website and shop open in a browser sheet inside
 * the app (close it to come back); the podcast and socials open in their own apps. Support
 * opens the in-app crisis lines so they work offline and when the website is down.
 * The welcome screen already has its own Support card, so it passes withoutSupport; Me shows the
 * merch shops under Club gear, so it passes withoutShops.
 */
export function ClubLinksSection({ withoutSupport = false, withoutShops = false }: { withoutSupport?: boolean; withoutShops?: boolean }) {
  const navigation = useNavigation<NavigationProp<RootParams>>();
  const groups = CLUB_LINK_GROUPS.map((g) => ({
    ...g,
    links: g.links.filter((l) => !(withoutSupport && l.id === 'support') && !(withoutShops && SHOP_LINK_IDS.has(l.id))),
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
                onPress={() => (link.id === 'support' ? navigation.navigate('Support') : openLink(link.url).catch(() => {}))}
              />
            ))}
          </Card>
        </React.Fragment>
      ))}
    </>
  );
}
