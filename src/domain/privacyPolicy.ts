/**
 * The app's privacy policy, in one place. The Privacy policy screen shows it, and
 * `npm run build:privacy` turns it into site/privacy.html, the public page both app stores link to
 * (GitHub Pages publishes the site/ folder). A test keeps the page and this text the same.
 *
 * Written from an audit of what the app actually stores and sends (31/10/2026). When a feature
 * starts collecting something new, or sends it somewhere new, change this, bump UPDATED_ON and
 * rebuild the page.
 */

/** Where the policy lives on the web (the address given to Apple and Google). */
export const PRIVACY_URL = 'https://treasurerrustnutssmc-del.github.io/RUSTNUTS-APP/privacy.html';

export const PRIVACY_EMAIL = 'apps@rustnutssmc.com.au';

/** ISO date the policy last changed. */
export const PRIVACY_UPDATED_ON = '2026-10-31';

/** A paragraph, or a list of points. */
export type PrivacyBlock = string | { points: string[] };

export interface PrivacySection {
  id: string;
  heading: string;
  blocks: PrivacyBlock[];
}

export const PRIVACY_INTRO =
  'This is how the Rustnuts app looks after your information: what it collects, why, who sees it, where it goes and what you can do about it. We’ve kept it in plain English.';

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    id: 'who',
    heading: 'Who we are',
    blocks: [
      'The Rustnuts app is run by Rustnuts Social Motorcycle Club Incorporated (“the club”, “we”), a social motorcycle club based in Greater Melbourne, Victoria, Australia. It is built by the club for its members, FNGs, supporters and their families.',
      `We follow the Australian Privacy Principles in the Privacy Act 1988. For anything in this policy, email us at ${PRIVACY_EMAIL}.`,
    ],
  },
  {
    id: 'collect',
    heading: 'What we collect',
    blocks: [
      'Mostly what you put into the app, plus what the club records about your membership and what the app needs to work. When the club first moves its member roster into the app, your board may load your email, mobile, emergency contact and bike registration from the club’s existing records before you sign in; you can check and change them on the Me screen.',
      {
        points: [
          'Your account: your email address, used to sign you in with a one-time code. There are no passwords.',
          'Your membership: your name, road name, chapter, membership status and dates (introduced, FNG, patched), who introduced you, your application note, positions you hold and your membership card.',
          'Your contact details: your mobile number and your emergency contacts (their name, relationship and phone number).',
          'Your profile, if you add them: a short bio, your birthday (day and month only, no year), your bikes, and each bike’s registration and expiry.',
          'Rider details, if you add them: your licence class and expiry, and your first aid expiry.',
          'Club life: ride RSVPs and sign-ups, check-ins and attendance, meeting apologies and notices, votes and ballots, Road Rules sign-offs, Rusty Bus bookings and logs, ride routes and route files you upload, merch orders, swap and sell listings, build threads, nominations and awards, skills you offer and mechanic reviews.',
          'Chats: your messages, reactions, photos, videos, GIFs, voice notes and links, which members you’ve blocked, and any message you report.',
          'Money: the fees and charges the club raises for you, the payments you tell us you’ve made (amount, date, method and your reference) and the receipts the treasurer issues. The app never asks for or stores card or bank numbers of yours.',
          'Club records: where the constitution needs them, board decisions about your membership and conduct records.',
          'Your location, speed and direction, only during a live ride you’ve turned on (see “Location” below).',
          'Your phone: a push notification token so the app can send you alerts, your notification settings, and which device type you use (iPhone or Android). Like most online services, our servers also log the IP address and device details of each sign-in, for security.',
        ],
      },
      'We don’t collect your contacts, your browsing, advertising identifiers or anything from other apps, and there is no analytics or advertising code in the app.',
    ],
  },
  {
    id: 'why',
    heading: 'Why we use it',
    blocks: [
      {
        points: [
          'To run your membership under the club’s constitution: applications, status changes, fees, meetings, votes and records.',
          'To organise rides safely: who’s coming, crews, briefings, where riders are during a live ride, and who to call in an emergency.',
          'To let members talk to each other in club chats and ride comms.',
          'To keep the club’s books and issue receipts.',
          'To send you notifications you’ve chosen, like new messages, ride changes and reminders.',
        ],
      },
      'We don’t sell your information, use it for advertising, or share it with anyone for their own marketing.',
    ],
  },
  {
    id: 'see',
    heading: 'Who in the club can see it',
    blocks: [
      'The app’s rules decide who sees what, and the database enforces them:',
      {
        points: [
          'Approved members see each other’s names, road names, chapter, status, bio, birthday (day and month), bikes and photos, and the chats they are part of.',
          'Your mobile number is seen by your chapter’s board and the club’s national office-bearers, and by other members only if you turn on “Share my mobile with members”. During a live ride, the riders sharing on it can see the ride leaders’ numbers.',
          'Your email, licence and first aid details, bike registrations and emergency contacts are seen by you, your chapter’s board and the club’s national office-bearers. If you raise an emergency or “I’m out” alert on a live ride, the ride leaders also see your mobile and emergency contacts so they can help.',
          'Your fees and payments are seen by you, your chapter’s board (including its treasurer), the club’s national office-bearers and the club’s Auditor.',
          'Conduct records are seen by you, the board and, if you appeal, the appeal panel. They are deleted on the schedule the constitution sets.',
          'Family accounts see the home screen, the ride calendar and their own details, but not the chats or other members’ details.',
          'Anyone who opens the app, signed in or not, sees only the club’s public information: chapters, sponsors and club links.',
        ],
      },
    ],
  },
  {
    id: 'location',
    heading: 'Location',
    blocks: [
      'The app uses your location only when you start sharing on a live ride. While it’s on, the other riders sharing on that ride can see where you are, how fast and which way you’re heading on a map, and the app can keep sharing while your screen is off. It switches itself off when you stop, when the ride ends, or at the switch-off time.',
      'We don’t keep a history of where you’ve been. Only your latest position is stored, and it’s deleted when you stop sharing. Any alert you raise during the ride (like “I’ve stopped” or an emergency) keeps the place you raised it until the ride’s live window closes, two hours after the ride’s planned finish (or midnight if it has none), and is then deleted with everything else from the ride.',
      'Ride weather and maps use the ride’s route and meeting places, not your own location.',
    ],
  },
  {
    id: 'media',
    heading: 'Camera, photos, microphone and voice',
    blocks: [
      {
        points: [
          'Camera: only when you take a photo or video to share, or scan the club’s check-in code.',
          'Photos and videos: only the ones you pick to share. Photos are resized before they upload. They’re stored privately and only members who can see that chat, listing or post can open them.',
          'Microphone: for voice notes you record and for ride comms. Ride comms is live voice between riders on the same ride. It isn’t recorded.',
        ],
      },
    ],
  },
  {
    id: 'services',
    heading: 'Services that help run the app',
    blocks: [
      'We use these companies to run the app. Each one only gets what it needs for its job:',
      {
        points: [
          'Supabase stores the club’s data and files. Our database is in Sydney, Australia.',
          'Google (Gmail) sends your sign-in code emails from the club’s email account.',
          'Expo delivers app updates and passes notifications to Google Firebase Cloud Messaging (Android) and Apple Push Notification service (iPhone). They see your device’s push token and the text of each notification.',
          'LiveKit carries ride comms voice between riders, live. It isn’t recorded.',
          'Open-Meteo gives ride weather. Your phone asks it directly, so it gets the ride’s route points and places and your phone’s internet (IP) address, but not your name or account.',
          'Google Maps (on Android) and Apple Maps (on iPhone) draw ride maps. If you tap Navigate, the route opens in your maps app, under that app’s own privacy terms.',
          'GIPHY supplies GIFs for chats. Your phone asks it directly, so it gets the words you search for and your phone’s internet (IP) address, and GIFs in chats load from its servers. GIPHY handles that under its own privacy policy.',
          'Link previews: when you post a link, our server fetches the page to get its title. The preview picture then loads from that website, so the website sees the internet (IP) address of each phone that shows it.',
          'Ride files you send to Garmin or another app, and things you share out of the app, go only where you choose to send them.',
        ],
      },
      'Some of these companies may handle data outside Australia, such as in the United States. We pick providers that protect it, and we only send what each needs.',
    ],
  },
  {
    id: 'safe',
    heading: 'Keeping it safe',
    blocks: [
      'Everything travels encrypted between the app and our servers. Every table and file in the database has rules that limit who can read or change it, so the app can’t show a member something the rules don’t allow. Only a few club officers who build and run the app can reach the system directly.',
      'If there’s ever a data breach likely to cause serious harm, we’ll tell the people affected and the Office of the Australian Information Commissioner, as the law requires.',
    ],
  },
  {
    id: 'keep',
    heading: 'How long we keep it',
    blocks: [
      {
        points: [
          'Live ride locations: deleted when you stop sharing, and anything left from the ride (including alerts) once its live window closes.',
          'Notification queue: deleted after 90 days.',
          'Conduct records: deleted on the dates the constitution sets.',
          'Financial records, receipts, meeting minutes and votes: kept as long as the club needs them for its books and the law (Australian law requires financial records to be kept for at least 5 years).',
          'Your account and profile: until you delete your account. That removes your sign-in, profile, contact details, emergency contacts, bikes, messages, ride sign-ups and listings straight away. The club keeps its books, minutes, votes, attendance, conduct records, past board seats and any message someone has reported, showing you as “Former member”, and clears your photo files.',
        ],
      },
    ],
  },
  {
    id: 'choices',
    heading: 'Your choices and rights',
    blocks: [
      {
        points: [
          'See and fix your details: most of your information is on the Me screen, where you can change it. For anything else, ask us.',
          'Turn things off: location sharing, notifications and phone sharing are all your choice, and you can change them any time in the app or your phone settings.',
          `Delete your account: in the app, go to Me and tap Delete my account (if you hold a board or national seat, step down first). Or email ${PRIVACY_EMAIL} from the email you sign in with and we’ll delete it within 30 days. Deleting your app account doesn’t end your club membership.`,
          `Get a copy: ask at ${PRIVACY_EMAIL} and we’ll send you the information we hold about you.`,
        ],
      },
    ],
  },
  {
    id: 'children',
    heading: 'Children',
    blocks: [
      'The app is for adults. It isn’t meant for anyone under 18, and we don’t knowingly collect information from children.',
    ],
  },
  {
    id: 'complaints',
    heading: 'Questions and complaints',
    blocks: [
      `Email ${PRIVACY_EMAIL}. We’ll reply within 30 days. If you’re not happy with our answer, you can complain to the Office of the Australian Information Commissioner at oaic.gov.au or on 1300 363 992.`,
    ],
  },
  {
    id: 'changes',
    heading: 'Changes to this policy',
    blocks: [
      'If we change how the app uses your information, we’ll update this policy and the date at the top, and tell members in the app if the change matters.',
    ],
  },
];

/** "31/10/2026" from an ISO date. */
export function privacyUpdatedLine(iso = PRIVACY_UPDATED_ON): string {
  const [y, m, d] = iso.split('-');
  return `Last updated ${d}/${m}/${y}`;
}
