/**
 * The 24/7 crisis and support lines, kept inside the app so a member can reach them offline or
 * while the club website is down. The same numbers are on the website's Support page
 * (rustnutssmc.com.au/resources.html, checked 01/11/2026), which also lists legal, rider and
 * money help. Change both together.
 */

export interface SupportLine {
  id: string;
  name: string;
  /** As shown, with spaces. */
  phone: string;
  /** A mobile number that takes texts, as shown. */
  text?: string;
  detail: string;
}

export interface SupportGroup {
  title: string;
  lines: SupportLine[];
}

export const SUPPORT_GROUPS: SupportGroup[] = [
  {
    title: 'Mental health and crisis, 24/7',
    lines: [
      { id: 'lifeline', name: 'Lifeline', phone: '13 11 14', text: '0477 13 11 14', detail: 'Crisis support and suicide prevention.' },
      { id: 'mensline', name: 'MensLine Australia', phone: '1300 78 99 78', detail: 'Counselling for men: mental health, relationships, anger, stress.' },
      { id: 'beyondblue', name: 'Beyond Blue', phone: '1300 22 4636', detail: 'Depression, anxiety and related conditions.' },
      { id: 'callback', name: 'Suicide Call Back Service', phone: '1300 659 467', detail: 'For anyone at risk, bereaved, or worried about someone.' },
      { id: 'suicideline-vic', name: 'SuicideLine Victoria', phone: '1300 651 251', detail: 'For anyone in Victoria affected by suicide or distress.' },
    ],
  },
  {
    title: 'Family and safety',
    lines: [
      { id: '1800respect', name: '1800RESPECT', phone: '1800 737 732', text: '0458 737 732', detail: 'For anyone affected by domestic, family or sexual violence.' },
      { id: 'mens-referral', name: "Men's Referral Service", phone: '1300 766 491', detail: 'For men wanting to change controlling or violent behaviour.' },
    ],
  },
];

/** tel: address with only the digits. */
export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/** sms: address with only the digits. */
export function smsUrl(phone: string): string {
  return `sms:${phone.replace(/[^\d+]/g, '')}`;
}
