/**
 * The club's own places online, as listed on rustnutssmc.com.au (checked 28/10/2026).
 * The website and its shop stay where they are; the app opens them in its own browser sheet
 * (see inAppBrowser.ts).
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

export const CLUB_LINK_GROUPS: ClubLinkGroup[] = [
  {
    title: 'The club online',
    links: [
      { id: 'website', label: 'Club website', detail: 'rustnutssmc.com.au', url: 'https://www.rustnutssmc.com.au/', icon: 'globe-outline' },
      {
        id: 'shop',
        label: 'Merch shop',
        detail: 'Order on the form, pay by bank transfer',
        url: 'https://www.rustnutssmc.com.au/shop.html',
        icon: 'shirt-outline',
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
      { id: 'linktree', label: 'Linktree', detail: 'Every club link in one place', url: 'https://linktr.ee/rustnutssmc', icon: 'link-outline' },
    ],
  },
];
