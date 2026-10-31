# Ask the club Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A members-only "Ask the club" screen where Claude Opus 5.5 answers club questions from the
constitution, Road Rules and the member's own view of the app, and proposes actions the member confirms.

**Architecture:** The phone builds a snapshot and keeps the conversation; the `ask-club` Edge Function
checks the member and the limits in the database, calls Claude with the constitution and Road Rules in a
cached system prompt, records the cost, and returns the reply and any proposed tool calls. The phone turns
each proposal into a card checked with the app's existing rule functions and runs it through the existing
`useClub()` / `useChat()` actions on Confirm.

**Tech Stack:** Expo SDK 58 / React Native 0.88 / TypeScript; Supabase Postgres + Edge Functions (Deno);
`npm:@anthropic-ai/sdk@1.3.0`; node:test via `npm test`; SQL tests via `npm run test:db`.

**Spec:** `docs/superpowers/specs/2026-10-31-club-assistant-design.md`

## Global Constraints

- Model `claude-opus-5-5`, `output_config.effort: 'medium'`, `thinking: { type: 'adaptive' }`, `max_tokens: 6000` (thinking counts towards it), beta `server-side-fallback-2026-07-01` with `fallbacks: 'default'`.
- Prices (µUS$ per token): in 4, cache write 5, cache read 0.2, out 20.
- Limits: 40 turns, 120,000 characters per request; `assistant_daily_limit` default 15; `assistant_month_budget_microusd` default 20,000,000. Days and months in Melbourne time (`private.club_date()`).
- Switched off unless `private.app_settings` `assistant_on` = `true` and the `ANTHROPIC_API_KEY` secret is set.
- Who: approved non-Family members (`private.is_approved_member()`).
- No question text is stored anywhere. Day rows older than two days are cleared.
- Dates shown DD/MM/YYYY; stencil font for headings, buttons, chips, dates and numbers; body font for sentences and typed input; no `Alert`.
- Thinking and every other assistant block is passed back unchanged; history is append-only.
- Exact copy: `Ask the club isn’t switched on yet.`, `You’ve asked 15 today. More tomorrow.` (with the limit's number), `Ask the club is resting until 1/12/2026: this month’s budget is used.` (with the next month's first day), `Ask the club can’t answer right now. Try again in a minute.`, `I can’t help with that one.`, `That’s as far as I got.`, `Ask the club needs signal.`, `The member didn’t confirm this, so nothing was done.`

## Review Focus

- A proposal naming a ride, booking, chat or member that isn't in the snapshot: the card names the problem and offers no Confirm (Task 4 test `unknown ids give a problem and no confirm`).
- The member asks again without answering a card: the next request still carries a `tool_result` for every `tool_use` (Task 4 test `unanswered proposals are closed before the next question`).
- A Melbourne date near midnight UTC or across daylight saving: the calendar link and the cards keep Melbourne times (Task 4 test `calendar link uses Melbourne local times`).
- A forged or oversized history (huge paste, wrong roles, non-array): the function refuses before calling Claude or counting a question (Task 2 test `bad or oversized messages are refused before start`).
- Claude down after the question is counted: the member gets the "can't answer right now" words and the cost of nothing is recorded (Task 2 test `a failed Claude call is reported and nothing spent`).

---

### Task 1: Database limits and budget

**Files:**
- Create: `supabase/migrations/20270590000000_club_assistant.sql`
- Create: `supabase/tests/club_assistant_test.sql`
- Modify: `scripts/test-db.sh` (append a fresh-database run of the new test, same pattern as `account_deletion_test.sql`)

**Interfaces:**
- Produces: `public.assistant_start() returns jsonb` → `{"constitution": {"label","body"}|null, "road_rules": {"number","body"}|null}`; `public.assistant_spent(p_microusd bigint) returns void` (service_role only); `public.assistant_status() returns jsonb` → `{"on": bool, "left_today": int, "daily_limit": int, "resting_until": date|null}` plus `"spent_microusd","budget_microusd","questions"` for `private.is_national()` callers (check the existing national helper name in migrations and use it).

- [ ] **Step 1: Write the failing SQL test** covering: family and pending refused (`Only approved members can ask the club.`); off refused (`Ask the club isn’t switched on yet.`); with `assistant_on` = true a member gets the constitution body and label and the latest Road Rules; the 16th question of a day is refused (`You’ve asked 15 today. More tomorrow.`) while another member still can; once `assistant_months.spent_microusd` ≥ budget the next is refused with the resting words naming the next month's first day; a different month is fresh; `assistant_spent` refused for `authenticated`, works for `service_role`; day rows two days old are gone after a question; status for a member has no spend keys, for the NEC it has them.
- [ ] **Step 2: Run** `npm run test:db` — Expected: FAIL (function does not exist).
- [ ] **Step 3: Write the migration**: the two private tables (RLS on, all revoked), the three functions (security definer, `search_path = ''`), grants as above. Constitution = the latest version of the `documents.kind = 'constitution'` document; Road Rules = highest `road_rules_versions.number`. Settings read with `coalesce`, defaults 15 and 20,000,000. Keep the word "drop" out of the file.
- [ ] **Step 4: Run** `npm run test:db` — Expected: all pass.
- [ ] **Step 5: Commit** `Ask the club: daily limit, monthly budget and sources in the database`

### Task 2: The ask-club handler (shared, tested in node)

**Files:**
- Create: `supabase/functions/_shared/askClub.ts`
- Test: `src/data/askClub.test.ts`

**Interfaces:**
- Produces:
  - `ASSISTANT_MODEL`, `NOT_SWITCHED_ON`, `CANT_ANSWER`, `CANT_HELP`, `CUT_OFF`, `MAX_TURNS`, `MAX_CHARS`, `MAX_OUT`
  - `type ToolName = 'rsvp' | 'join_crew' | 'leave_crew' | 'call_ride' | 'book_bus' | 'cancel_bus' | 'log_bus_km' | 'hand_bus_keys' | 'post_message' | 'add_ride'`
  - `ASSISTANT_TOOLS: ToolDef[]` (`{ name, description, strict: true, input_schema }`, every property required, `additionalProperties: false`, optional values as `""`)
  - `interface ApiBlock { type: string; [k: string]: unknown }`, `interface ApiMessage { role: 'user' | 'assistant'; content: ApiBlock[] }`
  - `interface Sources { constitution: { label: string; body: string } | null; roadRules: { number: number; body: string } | null }`
  - `checkMessages(raw: unknown): ApiMessage[] | string`
  - `buildRequest(sources: Sources, messages: ApiMessage[]): ClaudeRequest`
  - `costMicroUsd(usage: Usage): number` (rounded up to a whole µUS$)
  - `interface Proposal { id: string; name: ToolName; input: Record<string, unknown> }`
  - `interface AskReply { content: ApiBlock[]; text: string; proposals: Proposal[]; note: string | null }`
  - `handleAskClub(env: { ANTHROPIC_API_KEY?: string }, body: unknown, deps: AskDeps): Promise<{ status: number; body: AskReply | { error: string } }>` with `AskDeps = { start(): Promise<Sources>; claude(req: ClaudeRequest): Promise<ClaudeResponse>; spent(microusd: number): Promise<void> }`

- [ ] **Step 1: Write failing tests**: `no key means not switched on`; `bad or oversized messages are refused before start` (non-array, first turn not user, 41 turns, 120,001 characters → 400, `start` never called); `start's refusal words come back as 403`; `request shape`: model, effort, thinking, max_tokens, betas, fallbacks, tools in `ASSISTANT_TOOLS` order, system = [brief, constitution, Road Rules] with `cache_control` on the last system block only, top-level `cache_control`, messages passed through untouched (deepEqual); `missing sources say so in the system text`; `cost maths` (1,000 in + 2,000 write + 10,000 read + 500 out = 4,000 + 10,000 + 2,000 + 10,000 = 26,000 µUS$); `reply splits text and tool_use proposals and keeps content verbatim`; `refusal gives CANT_HELP`, `max_tokens adds CUT_OFF`; `a failed Claude call is reported and nothing spent` (503, `CANT_ANSWER`, `spent` not called); `spent gets the cost after a good call`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** in `askClub.ts`. The brief is the spec's "brief" paragraph written as instructions; constitution and Road Rules wrapped as `<constitution version="v4">…</constitution>`, `<road_rules version="3">…</road_rules>`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `Ask the club: the shared Edge Function handler`

### Task 3: The Edge Function wiring

**Files:**
- Create: `supabase/functions/ask-club/index.ts`
- Modify: `tsconfig.json` (exclude `supabase/functions/ask-club`)

**Interfaces:** Consumes `handleAskClub`. Member client = anon key + caller's Authorization (like `ride-voice-token`); `start` = `rpc('assistant_start')` mapping `road_rules` → `roadRules`; `spent` = service-role `rpc('assistant_spent')`; `claude` = `new Anthropic({ apiKey }).beta.messages.create(req)`. CORS like `link-preview`.

- [ ] **Step 1: Write it**; **Step 2:** `npx tsc --noEmit` and `npx expo lint` pass; **Step 3: Commit** `Ask the club: the ask-club Edge Function`

### Task 4: Cards, snapshot, calendar link and history (domain)

**Files:**
- Create: `src/domain/assistant.ts`
- Test: `src/domain/assistant.test.ts`

**Interfaces:**
- Consumes: `Proposal`, `ToolName`, `ApiMessage` from Task 2; existing `rsvpProblem`, `mustSignFirst` (Going gate, find its module), `crewProblem`, `leaveProblem`, `callProblem`, `bookProblem`, `cancelProblem`, `logKmProblem`, `handKeysProblem`, `postProblem`, `managesChapterRides`.
- Produces:
  - `buildSnapshot(me: Member, data: ClubData, chats: { id: string; title: string }[], now: string): string`
  - `type ActionPlan = { kind: 'rsvp'; rideId: string; answer: RsvpAnswer } | { kind: 'join_crew'; rideId: string; role: CrewRole } | { kind: 'leave_crew'; rideId: string } | { kind: 'call_ride'; rideId: string; state: RideCallState; reason: string; newDay: string | null } | { kind: 'book_bus'; input: BusInput } | { kind: 'cancel_bus'; bookingId: string } | { kind: 'log_bus_km'; input: KmInput } | { kind: 'hand_bus_keys'; toId: string; note: string } | { kind: 'post_message'; chatId: string; text: string } | { kind: 'open_calendar'; url: string } | { kind: 'send_idea'; toId: string; text: string }`
  - `interface ActionCard { id: string; heading: string; lines: string[]; problem: string | null; confirm: string; plan: ActionPlan | null }`
  - `cardFor(p: Proposal, ctx: { me: Member; data: ClubData; chats: { id: string; title: string }[]; now: string }): ActionCard`
  - `interface RideDraft { title: string; date: string; start: string; end: string; location: string; notes: string; label: 'north' | 'west' | 'rustnuts' | 'supported' | 'non_nuts' }`, `rideDraftProblem(d: RideDraft, today: string): string | null`, `calendarLink(d: RideDraft): string`, `ideaRecipient(me: Member, data: ClubData): Member | null`, `rideIdeaText(d: RideDraft): string`
  - `pendingToolIds(history: ApiMessage[]): string[]`, `nextMessages(history: ApiMessage[], results: Record<string, string>, question: string, snapshot: string | null): ApiMessage[]`

- [ ] **Step 1: Write failing tests**: snapshot holds only rides in the window, the member's answer and their own charges, and is the same string for the same inputs; one test per tool's card (heading and lines in the spec's table wording, the right `plan`); `unknown ids give a problem and no confirm`; `someone else's crew spot is refused` (join_crew always targets me); `going needs the Road Rules signed`; `add_ride for a ride runner opens the calendar`, `add_ride for anyone else sends the idea to the Road Captain, else the President`; `calendar link uses Melbourne local times` (dates param `YYYYMMDDTHHMMSS/…` with `ctz=Australia/Melbourne`, all-day form when start is empty, `Label: West` line in details, `src=rsmc.ridecommitee@gmail.com`); `bad drafts` (past day, end before start, bad time, empty title); `unanswered proposals are closed before the next question`; `snapshot only on the first message`; `history is append-only` (earlier messages deepEqual).
- [ ] **Step 2: Run** `npm test` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Ask the club: cards, snapshot, calendar link and history`

### Task 5: Live and demo assistant, and running a confirmed card

**Files:**
- Create: `src/data/assistantApi.ts`, `src/data/assistantRun.ts`
- Test: `src/data/assistantApi.test.ts`, `src/data/assistantRun.test.ts`

**Interfaces:**
- Produces: `interface AssistantStatus { on: boolean; leftToday: number; dailyLimit: number; restingUntil: string | null }`; `interface AssistantApi { status(): Promise<AssistantStatus>; ask(messages: ApiMessage[]): Promise<AskReply> }`; `liveAssistant(): AssistantApi` (invoke `ask-club`, rpc `assistant_status`, error words from the function body, `Ask the club needs signal.` on network failure); `demoReply(messages: ApiMessage[], ctx: { me: Member; data: ClubData; now: string }): AskReply` (pure); `useAssistantApi(): AssistantApi`; `runAction(plan: ActionPlan, deps: { club: Pick<ClubContextValue, 'setRsvp' | 'setCrew' | 'leaveCrew' | 'callRide' | 'bookBus' | 'cancelBus' | 'logBusKm' | 'handBusKeys'>; chat: Pick<ChatContextValue, 'send' | 'openDirect'>; me: Member; openUrl(url: string): Promise<void> }): Promise<string>` (resolves to the result text told back to the assistant).

- [ ] **Step 1: Failing tests**: demo answers the next ride from demo data; an FNG question cites 4.6–4.11; "put me down" proposes `rsvp` for the next ride; "bus" proposes `book_bus`; "add a ride" proposes `add_ride`; anything else gets the starters line; `runAction` calls the right action with the right arguments for each plan and returns `Done: …`; `send_idea` opens the direct chat then sends.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS). **Step 5: Commit** `Ask the club: live and demo assistant`

### Task 6: The screen, Home row, privacy

**Files:**
- Create: `src/screens/askClub.tsx`
- Modify: `src/navigation/types.ts` (`AskClub: undefined`), `src/navigation/RootNavigator.tsx` (register, title `Ask the club`), `src/screens/members.tsx` (Home row for approved non-Family members when `status().on` or demo), `src/domain/privacyPolicy.ts` (+ `npm run build:privacy`), `docs/store/privacy-answers.md`, `PRODUCT.md`, `DESIGN.md` (an "Ask the club" component note).

- [ ] **Step 1:** Read Impeccable's craft floor (`.claude/skills/impeccable/SKILL.md` and its references) and DESIGN.md before the UI edit.
- [ ] **Step 2:** Build the screen per the spec's "The screen" section using `Screen`, `Card`, `Button`, `Field`, `Notice`, `Small`, `Body`, `H2`, `Skull`.
- [ ] **Step 3:** `npm test`, `npm run typecheck`, `npx expo lint`, update privacy tests if they pin the text.
- [ ] **Step 4:** Look at it at 390×844 in the demo web build (starters, a reply, each card kind, Confirm → Done, an error); critique, audit and polish by hand.
- [ ] **Step 5: Commit** `Ask the club: the screen`

### Task 7: Review, live paste file, PR

- [ ] Independent reviewer subagent with only the diff and the spec; fix Critical and Important.
- [ ] All checks again; copy the migration to `/mnt/project-files/build/club-assistant.sql`; add it to `build/paste-queue.md`.
- [ ] Push, open the PR (attribution block), subscribe.
