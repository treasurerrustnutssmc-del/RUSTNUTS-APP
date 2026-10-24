# Ride crew: who's RC, TG, ATG and Officers on each ride (Stage 2, part 2)

**Type:** architectural (a new table, new database actions, a change to `set_rsvp` and
`ride_calendar`, a new screen). This is lane A of the parallel build
(`/mnt/project-files/build/parallel-stages.md`), so migrations use the `2026102413` prefix.
Claude approved this spec on 24 Oct 2026 under Jeff's standing rule. Jeff can veto any line,
and lines marked *inferred* are the ones most worth a look.

## Goal
Every ride shows its crew: the **Road Captain** out front, the **Tail Gunner** at the back,
an **Assistant Tail Gunner**, and any **Officers**. The board or ride committee fills the
spots, members can put their hand up for an open one, and anyone on the crew can step down.
That gives the "ride roles roster, with swap requests" from the Ambition & Timeline doc, and
the "who's TG" line that the briefing card (next spec) will show.

## Words
- **Crew spot:** one of `road_captain`, `tail_gunner`, `assistant_tail_gunner` or `officer`.
  These are the same names and short forms as the standing positions (`ROLE_LABEL`,
  `ROLE_SHORT`: RC, TG, ATG, O), so the formation labels match.
- **Crew managers for a ride:**
  - A North or West ride: that chapter's board (Road Captain included) or its Ride Committee.
  - A Rustnuts, Supported or Non-Nuts ride: any chapter's board or Ride Committee.
  - Anyone on the NEC can manage every ride.

## Rules (`src/domain/crew.ts`, mirrored by the database with the same words)
1. **One RC, one TG and one ATG per ride.** Officers have no limit. A person holds at most one
   spot on a ride.
2. **Who can crew:** approved Full or Nomad members who aren't on hiatus. *Inferred:* FNGs and
   supporters ride in the pack, and Legacy members have left.
   - Message: `Only Full and Nomad members can crew a ride.` and
     `Members on hiatus can’t crew a ride.`
3. **TG and ATG need first aid:** a first aid expiry on or after the ride's Melbourne start date.
   This comes from the profile hint "Required for Tail Gunners" and Tractor's ATG review being
   "subject to First Aid". *Inferred* for ATG.
   - Message: `Tail Gunners need a current first aid certificate on file.`
   - The app checks this only when it can see the date (yourself, or your own chapter's board).
     The database always checks it.
4. **Crew are going.** Joining the crew sets your answer to Going. You can't put someone on
   the crew who answered Can't make it (`They said they can’t make it.`). If someone on the
   crew changes their answer to Maybe or Can't make it, `set_rsvp` takes them off the crew.
5. **Who does what:**
   - A crew manager can put any eligible member in any spot, themselves included. If a single
     spot is taken, the new person replaces the old one, whose answer stays as it was.
   - Anyone eligible can take an **open** spot for themselves. A taken one gives
     `That spot’s taken.`
   - Anyone can step down from their own spot. A crew manager can take anyone off.
   - Moving to another spot on the same ride replaces your old one.
   - Otherwise: `Only the board or ride committee can put someone else on the crew.` and
     `Only the board or ride committee can take someone else off the crew.`
6. **When:** the crew can change until the ride's first Melbourne day is over, so a swap at the
   meeting point still works. After that it's a record: `The crew can’t change after the ride day.`
   On a cancelled ride: `That ride was cancelled.`
7. The usual first checks, in this order: `Sign in first.`, `Only approved members can do that.`,
   `No such ride.`

## Data (new migration `20261024130000_ride_crew.sql`)
- `public.crew_role` enum: `road_captain`, `tail_gunner`, `assistant_tail_gunner`, `officer`.
- `public.ride_crew`: `ride_id` (references rides, cascade), `member_id` (references members,
  cascade), `role`, `assigned_by` (member), `assigned_at`.
  - Primary key (`ride_id`, `member_id`).
  - Unique index on (`ride_id`, `role`) where `role <> 'officer'`.
- Row-level security: approved members can read it. Nobody writes it through the API.
- `public.set_crew(p_ride uuid, p_member uuid, p_role public.crew_role)` and
  `public.leave_crew(p_ride uuid, p_member uuid)` are SECURITY DEFINER actions applying the
  rules above. They're executable by authenticated users only.
- `public.set_rsvp` gains one step: an answer other than Going removes your crew spot on that
  ride.
- `public.ride_calendar()` gains a `crew` array for the rides it returns.
- `private.manages_ride(ride)` holds the crew-manager rule for both actions.

## App
- **Types:** `CrewRole`, `CrewSpot { rideId, memberId, role, assignedBy, assignedAt }`, and
  `ClubData.crew?: CrewSpot[]`.
- **Rules:**
  - `src/domain/crew.ts` exports `managesRide`, `crewProblem(me, ride, target, role, data, now)`
    and `leaveProblem(me, ride, target, data, now)`, each returning a message or null.
  - It also exports `crewFor(rideId, crew)` in RC, TG, ATG, Officers order, and
    `crewNeeded(ride, crew)`, which is true when the RC or TG spot is open.
- **Data:** `liveData` reads `crew` from `ride_calendar`. The live actions call `set_crew` and
  `leave_crew`, and the demo actions apply the same rules.
- **Ride screen:** a **Crew** section sits under the answer buttons. It has one row each for
  RC, TG, ATG, then Officers, with the stencil short form and the road name, or "Open".
  - **Your own spot:** shows **Step down**.
  - **An open spot:** shows **I'll do it** if you're eligible.
  - **For a crew manager:** the RC, TG and ATG rows show **Pick** (when open) or **Change**
    (when taken). The Officers row has **Add officer**. Each name has **Take off**, which uses
    `ConfirmButton`.
  - **If you're on the crew:** a line above the answers says that changing your answer takes
    you off the crew.
- **Pick crew screen** (`PickCrew`, a stack screen with `rideId` and `role`):
  - Lists eligible members: Going first, then the standing holders of the same position
    (in the ride's chapter for North or West rides, otherwise in yours), then everyone else.
    Each group is sorted by road name.
  - A short line explains who can crew and that TG and ATG need first aid.
  - Tapping a name sets the spot and goes back. Errors show inline, in a live region.
- **Rides list:**
  - Crew managers see a **Crew needed** tag on rides in the next 14 days with no RC or TG.
  - Crew members see their own spot as a tag (for example **TG**) on their rides.
- **Demo:** sample crew on the demo rides, including one ride with no TG, so every state shows
  at 390×844.

## Tests
- **`npm test`** (`src/domain/crew.test.ts`): every message above, plus:
  - single spots versus Officers, replacing, moving spots
  - self versus manager
  - chapter versus club rides, and an NEC member managing everything
  - the first-day boundary and all-day rides
  - the first aid date on the ride day itself
  - unknown first aid passing in the app
  - the list order and `crewNeeded`
  - Demo actions, including RSVP Maybe dropping the spot.
- **`npm run test:db`** (`supabase/tests/ride_crew_test.sql`): the same rules against the
  database.
  - The API can't write `ride_crew`.
  - Applicants and the public can't read it.
  - `set_rsvp` removes the spot.
  - `ride_calendar` returns `crew`.
- **`parity.json`:** a `crew` action with allowed and refused cases, covering a manager on
  their own chapter's ride, another chapter's board on it, a self-volunteer for an open and a
  taken spot, an FNG, and missing first aid.
- **Screens:** a look at Ride, Pick crew and Rides at 390×844, in the demo and live builds,
  plus the Impeccable critique, audit and polish passes.

## Not in this spec
- Swaps that need the other person to accept, and notifications. Stage 6 brings notifications.
  Until then a swap is one person stepping down and another taking the spot.
- Corner markers and other formation positions beyond these four.
- The briefing card, locked routes, Road Rules sign-off and the Rusty Bus each have their own spec.
