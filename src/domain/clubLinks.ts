/**
 * The club's own places online, as listed on rustnutssmc.com.au (checked 28/10/2026).
 * The website and its shop stay where they are; the app links out to them.
 */

export interface ClubLink {
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
      { label: 'Club website', detail: 'rustnutssmc.com.au', url: 'https://www.rustnutssmc.com.au/', icon: 'globe-outline' },
      {
        label: 'Merch shop',
        detail: 'Order on the form, pay by bank transfer',
        url: 'https://www.rustnutssmc.com.au/shop.html',
        icon: 'shirt-outline',
      },
      { label: 'Support and resources', detail: 'Mental health, legal and rider help', url: SUPPORT_URL, icon: 'heart-outline' },
    ],
  },
  {
    title: 'Twist the Throttle',
    links: [
      { label: 'Spotify', detail: 'The club podcast', url: 'https://open.spotify.com/show/3XAjIDT7vnwbMTdHlIB1PE', icon: 'headset-outline' },
      { label: 'YouTube', detail: 'Episodes on video', url: 'https://www.youtube.com/channel/UCR7EHAmE8weadPFOuQJCguQ', icon: 'logo-youtube' },
      {
        label: 'Facebook',
        detail: 'The podcast page',
        url: 'https://www.facebook.com/p/Twist-the-Throttle-Podcast-61569935990708/',
        icon: 'logo-facebook',
      },
      { label: 'Instagram', detail: '@twist.the.throttle.podcast', url: 'https://www.instagram.com/twist.the.throttle.podcast/', icon: 'logo-instagram' },
      {
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
      { label: 'West Chapter on Facebook', detail: 'Rustnuts SMC', url: 'https://www.facebook.com/RustnutsSMC/', icon: 'logo-facebook' },
      {
        label: 'North Chapter on Facebook',
        detail: 'Rustnuts SMC Northern Chapter',
        url: 'https://www.facebook.com/RustnutsSMCNorthernChapter/',
        icon: 'logo-facebook',
      },
      { label: 'Club Instagram', detail: '@rustnuts_social2019', url: 'https://www.instagram.com/rustnuts_social2019/', icon: 'logo-instagram' },
      { label: 'Linktree', detail: 'Every club link in one place', url: 'https://linktr.ee/rustnutssmc', icon: 'link-outline' },
    ],
  },
];
