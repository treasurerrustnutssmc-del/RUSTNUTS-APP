# Going needs the Road Rules signed (Stage 2, part 5 amendment)

**Type:** bounded. It changes two existing actions, `set_rsvp` and `set_crew`, and the ride screen's answer area.

On 25 Oct 2026 Jeff answered the decision card: "yes block them if they dont sign with a prompt to sign it". This replaces rule 6 ("Not a gate") of `2026-10-24-road-rules-design.md`. Claude approved this design under Jeff's standing rule, and Jeff can veto any line.

## Rule
A member who's asked to sign (`asksToSign`: approved and not Legacy) can't say **Going** while their Road Rules state is **unsigned** or **expired**.
- **Due soon** still counts as signed.
- **Maybe** and **Can't make it** always work.
- **Nothing published** (state `none`) means no block. Before the NEC publishes, nobody is stopped.
- **Answers already given stay.** Someone who said Going before the rules lapsed, or before a fresh version was published, keeps that answer. The briefing card's "Road Rules not signed" list already shows them to the RC.
- **Crew:** a manager can't put an unsigned member on the crew, because crewing makes them Going. Someone already on the crew stays on it.

## Messages and order (app and database, same words)
- **`set_rsvp`:** after its existing checks (sign in, approved, ride, cancelled, started, an answer picked), add: Going while asked to sign and unsigned or expired gives `Sign the Road Rules first.`
- **`set_crew`:** after its existing eligibility checks, add: a target who's asked to sign and is unsigned or expired gives `They haven’t signed the Road Rules yet.`
- **The database** uses `private.road_rules_signed(member)`, plus a check that a version exists and that the member isn't Legacy. The **app** uses `roadRulesStatus` and `asksToSign`.

## App
- **`src/domain/roadRules.ts`:**
  - `SIGN_FIRST` and `CREW_NOT_SIGNED`
  - `mustSignFirst(member, data, today): boolean`
  - `goingProblem(me, answer, data, today): string | null`
- **Providers:** demo and live `setRsvp` check `rsvpProblem`, then `goingProblem`. The crew check adds `mustSignFirst(target)` after eligibility, in the crew domain.
- **Ride screen:**
  - When `mustSignFirst` applies, the answer area shows the prompt card right above the answers: "Sign the Road Rules to say Going." with a big **Read and sign** button that opens Road Rules. This replaces the softer "Sign the Road Rules before you ride" banner.
  - The Going button stays visible but is turned off, with an accessibility hint that says why.
  - Maybe and Can't make it work as usual.
  - After signing, coming back to the ride turns Going on again.
- **Crew picker:** unsigned members are left off the list of people a manager can pick, or shown as unavailable with the reason, matching how ineligible members are already shown.

## Database
- **New migration `20261025180000_going_needs_road_rules.sql`.** It contains `create or replace` of `set_rsvp` and `set_crew`, each copied from its current definition in `20261024130000_ride_crew.sql` with the one added check. Grants are unchanged.
- **Its `delete from` lines** are the existing ones inside the copied bodies (crew removal), not new deletes. Jeff pastes it like the others.

## Tests
- **`npm test`:**
  - `goingProblem` and `mustSignFirst` for every state (none, unsigned, current, due soon, expired, an older version after a fresh publish, Legacy, applicant)
  - demo `setRsvp` and `setCrew`
- **`npm run test:db`:** the same cases on `set_rsvp` and `set_crew`, plus the existing crew tests still passing.
- **`parity.json`:**
  - Going while unsigned (refused), and Going while expired (refused)
  - Going while due soon, Maybe while unsigned, and Going with nothing published (all allowed)
  - Going as Legacy (allowed, if Legacy can answer)
  - crewing an unsigned member (refused)
- **Screens:** the ride screen at 390×844 for an unsigned member (the prompt, with Going turned off) and a signed one. Then the Impeccable passes.
