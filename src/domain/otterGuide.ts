// The secretary's guide to Draft from Otter: record the meeting, get the transcript out of Otter,
// draft in the app, check, save. Shown in the app (Draft from Otter > How it works) and kept the
// same as the shared Claude Doc. Button names are in “quotes” and must match the screens (tested).

export interface GuideSection {
  title: string;
  /** Numbered when `numbered`, else bullet points. */
  numbered?: boolean;
  items: string[];
  note?: string;
}

export const OTTER_GUIDE: GuideSection[] = [
  {
    title: 'At the meeting',
    numbered: true,
    items: [
      'Put the recorder or phone in the middle of the table, away from the bar and the coffee machine.',
      'Start the Otter recording when the chair opens the meeting, and stop it when the meeting closes.',
      'Say things out loud so the draft can hear them: names when people move and second (“Moved Torque, seconded Spanner”), the result of every vote (“Carried, 12 for, 2 against”), who will do each job and by when, and apologies at the start.',
      'Agenda items in the app before the meeting help too: the draft follows them in order.',
    ],
  },
  {
    title: 'Get the transcript out of Otter',
    numbered: true,
    items: [
      'Open the recording in Otter.',
      'Worth doing: rename “Speaker 1”, “Speaker 2” to people’s names or road names. The draft matches names to the member list much better.',
      'Open the recording’s menu (the three dots), choose Export, then Text, and pick TXT.',
      'Save the file to your phone, or copy all the text instead.',
    ],
    note: 'Word or PDF exports won’t work; it has to be plain text.',
  },
  {
    title: 'In the app',
    numbered: true,
    items: [
      'Go to Club business and open the meeting. It has to have already happened.',
      'In the minutes card, tap “Draft from Otter”.',
      'Tap “Pick the file” and choose the .txt, or paste the text into the box.',
      'Tap “Draft the minutes”. It takes about a minute for an hour’s meeting, so leave the screen open.',
      'Check the draft, then tap “Use this draft”. If the meeting already has minutes, confirm “Replace the draft minutes”.',
    ],
    note: 'The app saves the minutes as the meeting’s draft, ticks who was there, adds the action items and takes you back to the meeting. Share and confirm the minutes there as usual (10.8).',
  },
  {
    title: 'Check the draft before you save',
    items: [
      '“Check these” at the top: unclear votes, names or numbers the draft flagged. Fix each one in the minutes.',
      'Minutes: edit the text directly. Look hardest at motions, movers, seconders and results.',
      '“Who was there”: untick anyone wrongly ticked. “Heard as” shows when a name was matched from a nickname; names it couldn’t match are listed below.',
      '“Action items”: untick any you don’t want. An item needs a member to own it; items with no clear owner aren’t added.',
    ],
    note: 'Nothing is saved until you tap Use this draft. “Start again” throws the draft away.',
  },
  {
    title: 'Limits and privacy',
    items: [
      'Who can use it: whoever runs that meeting (the chapter board, or the NEC for a whole-club meeting).',
      'Five drafts a meeting, then finish it by hand.',
      'Each draft is one of your 15 Ask the club questions for the day, and comes out of the club’s monthly AI budget.',
      'About 3 hours of transcript is the most; split a longer meeting in two.',
      'The transcript goes to the club’s AI provider to write the draft and isn’t kept by the app.',
    ],
  },
  {
    title: 'If you see a message instead',
    items: [
      '“Export it from Otter as Text”: you picked a Word or PDF file. Export as TXT.',
      '“Too long to draft in one go”: split the transcript into two halves and draft each.',
      '“Ask the club is resting”: the club’s monthly AI budget is used up. Write the minutes by hand until the date shown.',
      '“Needs signal” or “can’t answer right now”: try again in a minute.',
    ],
  },
];
