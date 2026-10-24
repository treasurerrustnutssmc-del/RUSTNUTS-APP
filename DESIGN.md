---
name: Rustnuts SMC
description: The club's own app. Ink and steel, bone text, club red, and the Rustnuts Stencil voice.
colors:
  ink: "#111010"
  ink-raised: "#171515"
  steel: "#2a2a2c"
  steel-high: "#353437"
  line: "rgba(244,241,234,0.10)"
  line-strong: "rgba(244,241,234,0.22)"
  bone: "#F4F1EA"
  bone-dim: "#d8d3c7"
  bone-mute: "#96928a"
  club-red: "#8C1C24"
  club-red-bright: "#B92632"
  red-text: "#F2666F"
  ok: "#7BC48F"
  warn: "#E9A83A"
  danger: "#F2666F"
  logo-plate: "#FFFFFF"
  ride-north: "#2B64A8"
  ride-west: "#8C1C24"
  ride-club: "#F4F1EA"
  ride-supported: "#2A7048"
  ride-non-nuts: "#55555A"
typography:
  display:
    fontFamily: "Rustnuts Stencil, Arial Black, sans-serif"
    fontSize: "34px"
    letterSpacing: "1.5px"
  headline:
    fontFamily: "Rustnuts Stencil, Arial Black, sans-serif"
    fontSize: "26px"
    letterSpacing: "1px"
  title:
    fontFamily: "Rustnuts Stencil, Arial Black, sans-serif"
    fontSize: "19px"
    letterSpacing: "1px"
  name:
    fontFamily: "Rustnuts Stencil, Arial Black, sans-serif"
    fontSize: "16px"
    lineHeight: "22px"
    letterSpacing: "0.4px"
  body:
    fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    lineHeight: "22px"
  body-strong:
    fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "22px"
  small:
    fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    lineHeight: "18px"
  label:
    fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "1.4px"
rounded:
  sm: "4px"
  md: "8px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.club-red-bright}"
    textColor: "{colors.bone}"
    typography: "{typography.name}"
    rounded: "{rounded.sm}"
    height: "48px"
    padding: "0 16px"
  button-primary-pressed:
    backgroundColor: "{colors.club-red}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.bone}"
    rounded: "{rounded.sm}"
    height: "48px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "{rounded.sm}"
    height: "48px"
  card:
    backgroundColor: "{colors.ink-raised}"
    rounded: "{rounded.md}"
    padding: "16px"
  input:
    backgroundColor: "{colors.steel}"
    textColor: "{colors.bone}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: "48px"
  chip-red:
    backgroundColor: "{colors.club-red}"
    textColor: "{colors.bone}"
    rounded: "{rounded.sm}"
  chip-steel:
    backgroundColor: "{colors.steel}"
    textColor: "{colors.bone-dim}"
    rounded: "{rounded.sm}"
---

# Design System: Rustnuts SMC

Source of truth: `src/theme.ts` (tokens) and `src/ui/primitives.tsx` (components). If this file and the code disagree, the code wins, and this file gets fixed. The names of the north star and rules are Claude's (24 Oct 2026, under Jeff's blanket design approval), and Jeff can veto them.

## Overview

**Creative North Star: "Stencilled on Steel"**

The app should feel like the club itself: a black clubhouse wall with the name sprayed through a stencil, a red patch, and steel. It is dark because the club's look is dark (the website, the logo on black, the skull icon), not because dark is fashionable. Surfaces are flat ink and steel. Text is warm bone, never pure white. The club red is the one loud colour, and it's saved for things that matter: the main action, a rank earned, the selected answer.

The stencil does the talking. Titles, names, numbers, dates, buttons, tabs and chips are all set in Rustnuts Stencil, so even a list of rides reads as the club's. The plain body face is only there for sentences, typing and fine print, where a stencil stops being readable.

It's built for a phone in a hand beside a bike. Targets are big, there's one clear action per screen, contrast is high, and nothing hides behind hover.

**Key Characteristics:**
- Ink background, bone text, one club red.
- Rustnuts Stencil wherever a word is short enough to be a label.
- Flat surfaces, separated by hairlines and tone, not shadows.
- Real club artwork only: the logo, disc, skull and flannel.
- Ride colours are the website's key, always shown with their name.

## Colors

Warm near-black and bone, with one deep club red and a separate set of state colours.

### Primary
- **Club Red** (`club-red`): the patch red, from the logo. Used for filled chips for Full and Nomad, and the pressed state of the main button. It's the West ride colour too.
- **Bright Club Red** (`club-red-bright`): the main button, the selected choice, and tab badges.
- **Red Text** (`red-text`): red that's readable as text on ink. Used for the active tab, the focus ring and outlined FNG chips.

### Neutral
- **Ink** (`ink`): the screen background and headers.
- **Raised Ink** (`ink-raised`): cards.
- **Steel / High Steel** (`steel`, `steel-high`): inputs, quiet chips, pressed states and avatars' surroundings.
- **Hairline / Strong Hairline** (`line`, `line-strong`): card borders, dividers and outlined buttons.
- **Bone** (`bone`): headings, names and primary text.
- **Dim Bone** (`bone-dim`): running text.
- **Muted Bone** (`bone-mute`): labels, fine print and inactive tabs.
- **Logo Plate** (`logo-plate`): the white plate the real logo sits on, and the label colour on the North, Supported and Non-Nuts ride chips. It's never used as a surface anywhere else.

### States
- **OK, Warn, Danger** (`ok`, `warn`, `danger`): each sits on a 12% tint of itself for chips and notices. These are separate from the brand red, so an error never looks like a rank.

### Ride key
- **North** (`ride-north`), **West** (`ride-west`), **Rustnuts, the whole club** (`ride-club`), **Supported** (`ride-supported`) and **Non-Nuts** (`ride-non-nuts`). Each has its own text colour, at least 4.5:1, in `rideColors`.

**The One Red Rule.** Red marks the one thing that matters on a screen: the action, the earned rank or the chosen answer. If two things on a screen are red and only one matters, the other one changes.

**The Website Key Rule.** Ride colours match the club website's calendar key exactly, and always appear with their name, never as colour alone.

## Typography

**Display Font:** Rustnuts Stencil (falls back to Arial Black on the web)
**Body Font:** the platform sans (Helvetica Neue on the web, the system face on phones)

**Character:** A heavy club stencil for every short word, with a quiet plain sans for sentences. The stencil is the voice, and the sans gets out of its way.

### Hierarchy
- **Display** (34): the welcome and big moments.
- **Headline** (26): screen titles.
- **Title** (19, uppercase): section titles.
- **Name** (16/22): names, ride titles, dates and numbers on cards, and buttons.
- **Body** (15/22): sentences, notes and bios.
- **Small** (13/18): fine print, such as "Updated …" and helper text.
- **Label** (11, bold, uppercase, 1.4 tracking): field labels only.
- Chips and tab labels use the stencil at 11.5.

**The Stencil First Rule.** If it's a title, heading, name, button, tab, chip, badge, number or date, it's in Rustnuts Stencil. The body face is only for running sentences, typed input and fine print.

**The Real Wordmark Rule.** "RUSTNUTS" as a wordmark is always the artwork in `assets/logo.png`, never typed text styled to look like it.

## Layout

- **Width:** a single column, with content capped at 640 wide (`MAX_CONTENT_WIDTH`) so it never sprawls on a desktop browser.
- **Spacing:** steps of 4, 8, 12, 16, 24 and 32. Groups inside cards sit 8 to 12 apart, sections sit 24 or more apart, and there's more space above a section title than below it.
- **Navigation:** a bottom tab bar for the top-level sections (Home, Rides, Members, Board when you hold a board position, and Me), with a stack for detail screens such as a member or a ride.
- **Safe areas:** screens respect the safe areas, and the keyboard never covers the field you're typing in.

## Elevation & Depth

Flat. There are no drop shadows. Depth comes from tone: ink for the page, raised ink for cards and steel for controls, with 1px hairline borders. Pressed states darken or shift to steel instead of lifting.

**The Flat Clubhouse Rule.** Nothing floats. If something needs to stand out, it gets red or the stencil, never a shadow.

## Shapes

Small, firm corners: 4 on buttons, inputs, choices and chips, and 8 on cards and notices. Only avatars and the member disc are round. Borders are hairlines, and no card or row ever gets a thick coloured edge stripe.

## Components

### Buttons
- **Shape:** gently squared (4), at least 48 tall, with uppercase stencil labels at 16.
- **Primary:** bright club red with bone text. Pressed, it turns to the deeper club red.
- **Secondary:** a transparent button with a strong hairline border and bone text.
- **Danger:** an outline in the danger colour. Anything destructive goes through **ConfirmButton** (tap twice) because pop-up dialogs aren't allowed.
- **Quiet:** text only, with a steel pressed state.
- **Focus:** a 2px ring in red text colour. **Disabled:** 45% opacity. **Busy:** a spinner in place of the icon.

### Chips
- **Style:** small squared tags with uppercase stencil text at 11.5 and an optional icon.
- **Tones:**
  - Red: Full and Nomad.
  - Red outline: FNG.
  - Bone outline: Introduced, Legacy and roles.
  - Steel: Supporter and Family.
  - OK, Warn and Danger: states.
- **Ride chips** use the ride key colours.
- **Filter chips** on the Rides tab work as toggles at least 44 tall. When on, a chip fills with its colour and shows a tick. When off, it's outlined with a colour square.

### Cards / Containers
- **Cards:** raised ink with a hairline border, 8 corners and 16 padding, and no shadow. A card is never nested inside another card.

### Inputs / Fields
- **Style:** a steel fill with a hairline border, at least 48 tall, 4 corners, and body text in bone.
- **Labels:** each field has a label above it in the label style.
- **Focus:** red text colour.

### Navigation
- **Tab bar:** ink, with stencil labels at 11.5. The active tab is red text colour and inactive tabs are muted bone. The Board tab carries a red count badge for people waiting.
- **Headers:** ink. The Home header shows the skull.

### Choices
- A row of answers you can pick from (for example Going, Maybe, Can't make it), at least 40 tall. The chosen one is bright club red. On the ride screen the answer buttons are 72 tall, with an icon above the label.

### Notices
- Tinted blocks for info, OK, warning and danger, with an icon, an optional stencil title and body text. They're used for empty states and for reasons something can't be done.

### Crew
- **Crew section** (ride screen, under the answers): one card with a row each for RC, TG and ATG, then each Officer. A row has a steel tile with the stencil short form, the road name (or a muted "Open") and the full role under it, and its buttons below.
  - **Buttons:** "I'll do it" on an open spot only when you hold no spot on that ride. Crew managers get Pick or Change, and "Add officer" on the open Officer row.
  - **Take off / Step down:** the first tap is a secondary (outline) button, so a full crew doesn't make a card of red. The confirm step ("Yes, take off" / "Yes, step down") is the danger style.
  - **Locked:** on a cancelled ride or after the ride day the crew is a record. Only the people who crewed show, with no buttons and no Open rows. If nobody crewed, the section isn't shown.
- **Pick crew screen:** the role as the title, the ride and date under it, a line on who can crew, then Going, that chapter's standing holders and everyone else, each by road name. A member already on this ride's crew carries a "Now RC" (or TG, ATG, O) chip, so it doesn't read as a standing position. Tapping a name saves it and goes back. A refusal shows under that name.

### Route
- **Route shape** (`RouteShape`): the route's line in bone on a steel tile, with an ink edge under it. The start is a green dot and the finish a hollow bone square drawn under it, so a loop shows both. A key (Start, Finish) sits under the full shape; list rows get a 56 square thumbnail with no key. No map tiles.
- **Distance and climb:** stencil fact lines with icons, like the ride screen's date and time: km to one decimal place, climb in whole metres ("84.2 km", "1,240 m climb").
- **Chapter chip:** North and West in their ride colours, and Whole club in the Rustnuts (club) colours.
- **Ride screen Route section** (between the answers and the crew): one card with the route's name (tapping it opens the Route screen), the shape, distance and climb, the numbered stops, and **Open in maps app**, a secondary button here because the chosen answer is the screen's red. Crew managers get **Choose route**, or **Change** and **Remove** (`ConfirmButton`). After the ride day, or on a cancelled ride, it's a record with no buttons. With no route and nothing the viewer can do, the section isn't shown.
- **Route library** (from a row at the top of the Rides tab): chapter filter chips like the Rides chips, then one card of rows (thumbnail, name, distance, chapter chip), newest first. Managers get **Add route**, the screen's red.
- **Route screen:** chapter chip, the name, distance and climb, the full shape, then **Open in maps app** as the primary. Notes, numbered stops and the rides using it follow. Managers get **Edit** and **Archive** (`ConfirmButton`, secondary first tap).
- **Add / edit route:** **Pick GPX file** is the red until a file is read, then **Save** is. The summary (shape, distance, climb, stops) shows for checking before saving, with **Replace file**. Chapter choices only offer what the person can file under.
- **Choose route:** the ride and date, a switch for every chapter's routes (off: the ride's chapter and whole-club), then the library rows. The route already on the ride carries an "On this ride" chip. Tapping one saves it and goes back.
- On the web, **Open in maps app** reads **Download GPX** and saves the file instead of opening the share sheet.

### Signature pieces
- **Member disc:** the real round MEMBER patch art, shown only on Full members and Nomads.
- **Flannel:** a flannel photo under a 76% ink wash. It's an accent only, used for the welcome, the waiting screen, the Home greeting and the disc moment.
- **Logo and skull:** the real artwork, never redrawn or recoloured.

## Do's and Don'ts

### Do:
- **Do** set every title, name, number, date, button, tab and chip in Rustnuts Stencil.
- **Do** keep one red thing per screen that matters, and make everything else bone, steel or ink.
- **Do** make every tap target at least 44pt (48 on Android) and keep text contrast at 4.5:1 or better.
- **Do** show ride colours with their names, in the website's key.
- **Do** use ConfirmButton for anything destructive, and a Notice for "why not".
- **Do** show dates as DD/MM/YYYY and times in Melbourne time.

### Don't:
- **Don't** type "RUSTNUTS" in a font to fake the wordmark, or redraw or recolour the logo, disc or skull.
- **Don't** show the member disc on anyone who isn't Full or Nomad.
- **Don't** use drop shadows, glows, gradient text or glassy blur.
- **Don't** use pop-up dialogs (`Alert`).
- **Don't** put a small uppercase eyebrow label above a heading. The heading speaks for itself.
- **Don't** use the group photo of the men.
- **Don't** use the flannel as a general background. It's for its four moments only.

## Stage 3 (lane B): chat and photos

- **Tab bar:** Home, Chat, Rides, Members, Board (board members), Me. Chat carries a red unread count; its spoken label is "Chat, N unread".
- **Chat list:** one card of rows. Each row has an icon badge (club, chapter flag, big table, NEC, committee, ride) or the person's avatar for a private chat, the chat name in stencil, the last message on one line, the time in stencil and a red unread count.
- **Bubbles:** other people's messages are outlined ink cards with the avatar at the bottom left and an author line (stencil name, rank chip, top role chip). Your own are filled steel, right-aligned, with no author line. Runs from one person within a few minutes share one author line. Day labels (Today, Yesterday, DD/MM/YYYY) sit centred in stencil.
- **Tapping a message** opens its actions under it: six reaction squares, Reply, Pin (moderators), Report, and a two-tap ConfirmButton to remove. Reaction counts sit under the bubble as pills.
- **Composer:** steel field one line high that grows to six lines, with photo, camera (phones only) and a stencil GIF button to its left, and a red send square to its right. The GIF panel opens under it and says "Powered by GIPHY".
- **Media:** one photo fills the bubble at its own shape (from 2:1 wide to a little taller than square); two to four sit in a two-across grid. Videos show a still with a play mark. Link cards are steel with the site in stencil.
- **Photos screen:** Latest / Ride walls choices, a three-across grid with 3pt gaps, and a black full-screen viewer with the poster's name, the date and "Open the chat".
