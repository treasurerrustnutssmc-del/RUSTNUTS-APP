/**
 * The club's own places online, as listed on rustnutssmc.com.au (checked 28/10/2026) plus the club
 * Discord (01/11/2026). The website and its shop stay where they are; the app opens them in its
 * own browser sheet (see inAppBrowser.ts). Members' merch is ordered in the Discord #merch-shop
 * (gated by Discord roles), public merch on the website shop.
 */

export interface ClubLink {
  id: string;
  label: string;
  /** Short line under the label. */
  detail: string;
  url: string;
  /** Ionicons name. */
  icon: string;
}

export interface ClubLinkGroup {
  title: string;
  links: ClubLink[];
}

export const SUPPORT_URL = 'https://www.rustnutssmc.com.au/resources.html';

/** The club's Discord server: a permanent invite (never expires) that lands in #welcome-and-rules. */
export const DISCORD_INVITE_URL = 'https://discord.gg/D8NpBNqqVj';
/** #merch-shop on the club Discord, where Full members order member designs with the club bot (/buy). */
export const DISCORD_SHOP_URL = 'https://discord.com/channels/1443170738444959865/1566372842394751067';

/** The public merch shop on the club website: supporter designs anyone can buy. */
export const PUBLIC_SHOP_URL = 'https://www.rustnutssmc.com.au/shop.html';

/**
 * Merch on the Me screen. Two stores: members' designs in the Discord #merch-shop (/buy with the
 * club bot, gated by Discord roles), public designs on the website. A member who isn't in the
 * club Discord yet gets the permanent invite, since the channel link can't open for them.
 */
export const MERCH_SHOP_LINKS: ClubLink[] = [
  {
    id: 'discord-shop',
    label: 'Members’ merch shop',
    detail: 'Member designs, order with /buy in the club Discord',
    url: DISCORD_SHOP_URL,
    icon: 'shirt-outline',
  },
  {
    id: 'discord-join',
    label: 'Not in the club Discord yet?',
    detail: 'Join it first, then open the members’ shop',
    url: DISCORD_INVITE_URL,
    icon: 'enter-outline',
  },
  {
    id: 'shop',
    label: 'Public merch shop',
    detail: 'Supporter designs on the website, pay by bank transfer',
    url: PUBLIC_SHOP_URL,
    icon: 'storefront-outline',
  },
];

/** The club-links rows that Me already shows under Club gear. */
export const SHOP_LINK_IDS: ReadonlySet<string> = new Set(['discord-shop', 'shop']);

export const CLUB_LINK_GROUPS: ClubLinkGroup[] = [
  {
    title: 'The club online',
    links: [
      { id: 'website', label: 'Club website', detail: 'rustnutssmc.com.au', url: 'https://www.rustnutssmc.com.au/', icon: 'globe-outline' },
      {
        id: 'discord-shop',
        label: 'Members’ merch shop',
        detail: 'Member designs, in the club Discord (Full members)',
        url: DISCORD_SHOP_URL,
        icon: 'shirt-outline',
      },
      {
        id: 'shop',
        label: 'Public merch shop',
        detail: 'Supporter designs on the website, pay by bank transfer',
        url: PUBLIC_SHOP_URL,
        icon: 'storefront-outline',
      },
      { id: 'support', label: 'Support and resources', detail: '24/7 crisis lines, in the app', url: SUPPORT_URL, icon: 'heart-outline' },
    ],
  },
  {
    title: 'Twist the Throttle',
    links: [
      { id: 'podcast-spotify', label: 'Spotify', detail: 'The club podcast', url: 'https://open.spotify.com/show/3XAjIDT7vnwbMTdHlIB1PE', icon: 'headset-outline' },
      { id: 'podcast-youtube', label: 'YouTube', detail: 'Episodes on video', url: 'https://www.youtube.com/channel/UCR7EHAmE8weadPFOuQJCguQ', icon: 'logo-youtube' },
      {
        id: 'podcast-facebook',
        label: 'Facebook',
        detail: 'The podcast page',
        url: 'https://www.facebook.com/p/Twist-the-Throttle-Podcast-61569935990708/',
        icon: 'logo-facebook',
      },
      { id: 'podcast-instagram', label: 'Instagram', detail: '@twist.the.throttle.podcast', url: 'https://www.instagram.com/twist.the.throttle.podcast/', icon: 'logo-instagram' },
      {
        id: 'podcast-iheart',
        label: 'iHeart',
        detail: 'Listen on iHeartRadio',
        url: 'https://www.iheart.com/podcast/269-twist-the-throttle-podcast-243518235/',
        icon: 'radio-outline',
      },
    ],
  },
  {
    title: 'Follow the club',
    links: [
      { id: 'west-facebook', label: 'West Chapter on Facebook', detail: 'Rustnuts SMC', url: 'https://www.facebook.com/RustnutsSMC/', icon: 'logo-facebook' },
      {
        id: 'north-facebook',
        label: 'North Chapter on Facebook',
        detail: 'Rustnuts SMC Northern Chapter',
        url: 'https://www.facebook.com/RustnutsSMCNorthernChapter/',
        icon: 'logo-facebook',
      },
      { id: 'club-instagram', label: 'Club Instagram', detail: '@rustnuts_social2019', url: 'https://www.instagram.com/rustnuts_social2019/', icon: 'logo-instagram' },
      { id: 'discord', label: 'Club Discord', detail: 'Chat, votes and the members’ merch shop', url: DISCORD_INVITE_URL, icon: 'chatbubbles-outline' },
      { id: 'linktree', label: 'Linktree', detail: 'Every club link in one place', url: 'https://linktr.ee/rustnutssmc', icon: 'link-outline' },
    ],
  },
];
