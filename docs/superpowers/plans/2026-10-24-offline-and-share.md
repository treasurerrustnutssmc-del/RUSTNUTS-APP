# Offline mode and sharing a ride (Stage 6, part 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app opens and shows the club with no signal, and a ride can be shared to Messenger and the like.

**Architecture:**
- **Offline:** a small cache module saves each good live load to AsyncStorage, keyed by the signed-in
  user. `LiveClubProvider` shows the saved copy at start-up while it loads, and keeps it when the load
  fails. The existing refresh strip says it's offline and when the copy was saved.
- **Share:** the share text is a pure function. The ride screen calls React Native's `Share`, falling back
  to selectable text on a browser with no share sheet.

**Tech Stack:** AsyncStorage (already installed), React Native `Share`, node:test.

**Spec:** `docs/superpowers/specs/2026-10-24-phone-superpowers-design.md`, section 2.

## Global Constraints

- **What the copy holds:** only what the signed-in person was already allowed to see. It's deleted on
  sign-out.
- **Offline actions:** these fail with the existing "No connection. Check your signal and try again."
  (`friendlyError`). Nothing is queued except live-ride alerts (part 1).
- **Dates:** shown as DD/MM/YYYY, with times in Melbourne time.
- **Shared files:** in `clubContext.ts`, `LiveClubProvider.tsx` and `rides.tsx`, only add, in one block
  per file marked `// Lane E: offline` or `// Lane E: share`.

## Review Focus

1. **A cache saved by a different person on a shared phone:** it's never shown. Test in Task 1.
2. **A corrupt or old-shaped cache:** it's ignored, and nothing crashes. Test in Task 1.
3. **Signing out while offline:** the cache is still deleted. Task 2.
4. **A ride with no location, or an all-day ride:** the share text still reads well. Test in Task 3.
5. **The web with no `navigator.share`:** the text is shown for copying, and there's no silent failure.
   Task 3.

---

### Task 1: Offline cache

**Files:**
- Create: `src/data/offlineCache.ts`
- Test: `src/data/offlineCache.test.ts`

**Interfaces:**
- `interface KeyValue { getItem(k): Promise<string|null>; setItem(k, v): Promise<void>; removeItem(k): Promise<void> }`
- `createClubCache(store: KeyValue)` returns:
  - `save(userId: string, data: ClubData, savedAt: string): Promise<void>`
  - `load(userId: string): Promise<{ data: ClubData; savedAt: string } | null>`
  - `clear(): Promise<void>`
- `clubCache`, the instance bound to AsyncStorage. It uses the key `club.cache.v1`.

- [ ] **Step 1: Write the failing tests.**
  - A save then load round-trips.
  - Loading as another user gives null.
  - Corrupt JSON gives null.
  - A missing `members` array gives null.
  - `clear` empties the cache.
  - A store that throws makes `save` and `load` resolve quietly (load gives null).
- [ ] **Step 2:** Run `npm test` and expect it to fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` and expect it to pass.
- [ ] **Step 5:** Commit.

### Task 2: Offline in the live provider, and the strip

**Files:**
- Modify: `src/data/clubContext.ts`: add the optional `savedAt?: string | null` to `ClubContextValue`.
  It says when the data on screen was saved, and is set only while showing the saved copy after a
  failed load.
- Modify: `src/data/LiveClubProvider.tsx`:
  - When a user is known, load the cache. If nothing is loaded yet for them, show it with `loadedFor = uid`.
  - Save after each good load.
  - Clear on sign-out.
  - Set `savedAt` when the newest load failed and the cache is on screen.
- Modify: `src/ui/RefreshBanner.tsx`: when `savedAt` is set, the text reads "Offline. Showing what was
  saved 24/10/2026 7:30 am." with the same Try again.
- Test: `src/data/offlineCache.test.ts`, with an `offlineText(savedAt)` helper exported from
  `offlineCache.ts`: "Offline. Showing what was saved 24/10/2026 7:30 am."

- [ ] **Step 1:** Write the failing test for `offlineText`.
- [ ] **Step 2:** Run `npm test` and expect it to fail.
- [ ] **Step 3:** Implement the helper, the provider changes and the strip.
- [ ] **Step 4:** Run `npm test`, `npm run typecheck` and `npx expo lint`, and expect all of them to pass.
- [ ] **Step 5:** Commit.

### Task 3: Share a ride

**Files:**
- Create: `src/domain/share.ts`, `src/domain/share.test.ts`
- Modify: `src/screens/rides.tsx` (the Lane E share block): a secondary "Share" button with the
  `share-outline` icon under the details card.

**Interfaces:**
- `rideShareText(ride: Ride): string`, giving "West breakfast run · Sat 07/11/2026 8:30 am · BP
  Ravenhall. Answer in the Rustnuts app."
  - An all-day ride gives "All day", or "All day, to DD/MM/YYYY" when it runs over several days.
  - With no location, that part is left out.
  - A cancelled ride starts "CANCELLED: ".

- [ ] **Step 1: Write the failing tests:** a timed ride, an all-day multi-day ride, no location, and
  cancelled.
- [ ] **Step 2:** Run `npm test` and expect it to fail.
- [ ] **Step 3:** Implement. The screen calls `Share.share({ message })`. If that throws, or
  `Platform.OS === 'web'` without `navigator.share`, it shows the text in a selectable `Notice` titled
  "Copy this".
- [ ] **Step 4:** Run `npm test`, `npm run typecheck` and `npx expo lint`, and look at the ride screen at
  390×844.
- [ ] **Step 5:** Commit.

### Task 4: Review and ship

- [ ] **Step 1:** An independent reviewer checks the diff against the spec and this plan. Fix Critical
  and Important findings.
- [ ] **Step 2:** Run Impeccable's critique, audit and polish on the ride screen and the strip.
- [ ] **Step 3:** Run all four checks and show the output. Open the PR.
