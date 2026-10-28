# Plan: attendance rules, Big 4 rides, terms and the membership card

Spec: `docs/superpowers/specs/2026-10-28-attendance-big4-terms-card-design.md`. Executed inline by the thread that wrote it (Claude approves, Jeff can veto). Each task: failing test first, watch it fail, code, watch it pass, commit.

1. **Types.** Append one lane block to `types.ts`: `Big4Ride`, `MeetingType`, `AttendanceExemption`; `CheckinSession.meetingType?`; `ClubData.big4Rides?`, `ClubData.exemptions?`.
2. **Big 4 rules** `src/domain/big4.ts` + test: `isBig4`, `big4For(member)`, `canDesignateBig4`, `designateBig4Problem`, `big4Eligibility` (5.4), `SUPPORTERS_NO_BIG4`.
3. **Exemptions and meeting types** in `attendance.ts` + test: `exemptionProblem`, `isExcused`, `meetingTypeOf`, meeting type check in `openCheckinProblem`.
4. **Standing** `src/domain/standing.ts` + test: `atLeast(held, num, den)`, `standingOf(member, data, today)` for Full, Nomad, FNG, hiatus.
5. **Terms** `src/domain/terms.ts` + test: `termEndsOn`, `termState`.
6. **Card** `src/domain/card.ts` + test: `cardOf(member, data, today)` (dues state, disc).
7. **Demo** actions in `demoStage4.ts` style (`designateBig4`, `undesignateBig4`, `setExemption`, `openCheckin` meeting type), demo data (one Big 4, a few classified meetings), demo tests.
8. **Database** `supabase/migrations/20270405000000_attendance_big4.sql`: tables, column, RLS, grants, `designate_big4`, `undesignate_big4`, `set_exemption`, `open_checkin` with `p_meeting_type`. `supabase/tests/attendance_rules_test.sql` wired into `scripts/test-db.sh`. Parity cases plus runner support in `parity.test.ts`/`parity-sql.mts`/fixture.
9. **Live data** `liveData.ts` loads `big4_rides`, `attendance_exemptions`, session meeting types; `LiveClubProvider` actions; `database.types.ts` entries.
10. **Screens**: Open meeting chips; Run check-in excuse; Ride detail Big 4 chip, designation and 5.4 line; `AttendanceSummary` → standing lines; FNG tracker lines; new `Attendance` board screen; terms on Board and profile; Membership card screen + Me row; navigation entries.
11. **Docs**: PRODUCT.md lane block, paste file `/mnt/project-files/build/attendance-big4.sql`.
12. **Checks and review**: `npm test`, `npm run test:db`, `npm run typecheck`, `npx expo lint`, screens at 390×844, independent reviewer subagent, fix Critical/Important, merge.
