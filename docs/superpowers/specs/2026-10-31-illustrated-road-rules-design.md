# Illustrated Road Rules (Chris's draft, 30 Oct 2026)

**Type:** bounded. Static content and four new screens; no database change, no SQL.

Chris (Dysco) sent two Word documents and wants both in the app:
- *Rustnuts SMC Road Rules – Condensed, All Diagrams*: 18 rules with 17 diagrams in place.
- *Rustnuts SMC Road Rules – Diagrams Only*: the same 17 diagrams, in their own order, "read with the written rules".

Both are marked "Illustrated draft for review · Club adoption pending". The originals are in the project files under `reference/road-rules/`.

## Decisions
- **In-app screens, not .docx files.** The text is in `src/domain/roadRulesGuide.ts` word for word (taken from the document, not retyped); the diagrams are bundled PNGs in `assets/road-rules/`.
- **One set of images.** The two documents' diagrams differ only in the heading strip (the condensed set prints the rule number, e.g. "3 Ride Roles"). The numbered set is used in both views, reduced to 128 colours at full width (17 images, about 2.6 MB).
- **Not the signed version.** The signed Road Rules stay the NEC's published text. Every draft screen says it's a draft and that adoption is pending. When the club adopts it, the NEC can publish the text as a new version in the usual way (the diagrams stay here).
- **Readable on a phone.** An A4 diagram at phone width is too small to read, so any diagram opens full screen with Fit / 2× / 3× and scrolls both ways (plain ScrollViews: no new native module, so it ships over the air).

## Screens
- **Road Rules** gets an *Illustrated draft* section (also shown when nothing is published yet): *Illustrated Road Rules* and *Road Rules diagrams*.
- **Illustrated Road Rules** (`RoadRulesGuide`): draft notice, *See all 17 diagrams*, and the 18 rules as a list.
- **One rule** (`RoadRulesRule`): the rule's text with its diagrams in place ("Figure N · caption"), and Rule N−1 / Rule N+1.
- **Road Rules diagrams** (`RoadRulesDiagrams`): the diagrams in Chris's order, each labelled "Rule N · caption".
- **Diagram** (`RoadRulesDiagram`): full screen zoom, a link to its rule, Previous / Next.
