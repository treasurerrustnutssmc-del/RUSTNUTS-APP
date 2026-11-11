// The Me tab used to be one scroll of about 30 sections. It now keeps the profile card on top and
// folds the rest into six groups, each with a one-line summary you can read without opening it. A
// group starts open only when something in it needs the member. The wording and the open/closed
// rule live here so they can be tested without drawing a screen.
import { formatCents } from './fees';

export type MeGroupId = 'year' | 'details' | 'rules' | 'fees' | 'settings' | 'help';

export type MeInput = {
  contacts: number;
  bikes: number;
  owingCents: number;
  onHiatus: boolean;
  /** Where the member stands with the Road Rules, or null when they are not asked to sign. */
  roadRules: { text: string; urgent: boolean } | null;
};

export type MeGroup = { id: MeGroupId; title: string; summary: string; startsOpen: boolean };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function meGroups(m: MeInput): MeGroup[] {
  const rules = m.roadRules ? `Road Rules: ${m.roadRules.text[0].toLowerCase()}${m.roadRules.text.slice(1)}` : 'Club documents and policies';
  const details =
    m.contacts === 0
      ? 'No emergency contact yet'
      : `${plural(m.contacts, 'emergency contact', 'emergency contacts')}, ${m.bikes === 0 ? 'no bikes' : plural(m.bikes, 'bike', 'bikes')}`;
  const fees = m.owingCents > 0 ? `${formatCents(m.owingCents)} owing` : m.onHiatus ? 'On hiatus: no new fees' : 'All paid up';
  return [
    { id: 'year', title: 'My club year', summary: 'Attendance and badges', startsOpen: false },
    { id: 'details', title: 'My details', summary: details, startsOpen: m.contacts === 0 },
    { id: 'rules', title: 'Rules and papers', summary: rules, startsOpen: m.roadRules?.urgent === true },
    { id: 'fees', title: 'Fees', summary: fees, startsOpen: m.owingCents > 0 },
    { id: 'settings', title: 'Notifications and privacy', summary: 'Alerts and sharing your mobile', startsOpen: false },
    { id: 'help', title: 'Help and the club online', summary: 'Feedback, support, links and sponsors', startsOpen: false },
  ];
}
