// The illustrated Road Rules: Chris's draft of 30 October 2026, built into the app as he wrote it.
// It comes as two documents: the condensed rules with every diagram in place, and the diagrams on
// their own (read with the written rules). The club hasn't adopted it yet, so it isn't a version
// anyone signs: the signed text is still the NEC's published one (roadRules.ts).

export type DiagramId =
  | "roles"
  | "formation"
  | "single-file"
  | "axle-to-axle"
  | "readiness"
  | "signals-1"
  | "signals-2"
  | "signals-3"
  | "pass-signal"
  | "arm-up"
  | "abort"
  | "turning"
  | "keep-left"
  | "snake"
  | "protected"
  | "support-vehicles"
  | "tail-gunner";

export interface RulesDiagram {
  id: DiagramId;
  /** The rule number printed on the diagram. */
  rule: number;
  /** The caption, in the diagrams-only document's words. */
  caption: string;
}

export type GuideBlock =
  | { kind: "para" | "bullet" | "subheading"; text: string }
  | { kind: "diagram"; id: DiagramId };

export interface GuideRule {
  number: number;
  title: string;
  blocks: GuideBlock[];
}

/** The draft's cover. */
export const GUIDE = {
  title: "Rustnuts SMC Road Rules",
  subtitle: "Group riding procedures",
  date: "2026-10-30",
  status: "Club adoption pending",
};

/** The diagrams, in the diagrams-only document's order. */
export const DIAGRAMS: RulesDiagram[] = [
  { id: "roles", rule: 3, caption: "Ride roles and assigned tasks" },
  {
    id: "formation",
    rule: 7,
    caption: "Staggered formation and normal pack order",
  },
  { id: "single-file", rule: 7, caption: "Staggered to single file" },
  {
    id: "axle-to-axle",
    rule: 9,
    caption: "Staggered and axle to axle formation",
  },
  { id: "readiness", rule: 8, caption: "Raised hand readiness check" },
  { id: "signals-1", rule: 11, caption: "Hand signals page 1 of 3" },
  { id: "signals-2", rule: 11, caption: "Hand signals page 2 of 3" },
  { id: "signals-3", rule: 11, caption: "Hand signals page 3 of 3" },
  { id: "pass-signal", rule: 11, caption: "Passing a signal through the pack" },
  { id: "arm-up", rule: 12, caption: "The RC arm up overtaking procedure" },
  { id: "abort", rule: 12, caption: "Closing the passing window and aborting" },
  { id: "turning", rule: 13, caption: "Turning paths" },
  { id: "keep-left", rule: 13, caption: "Keep left for returning riders" },
  { id: "snake", rule: 14, caption: "Snake lane change" },
  { id: "protected", rule: 15, caption: "Protected lane change" },
  { id: "support-vehicles", rule: 10, caption: "Support vehicle arrangements" },
  {
    id: "tail-gunner",
    rule: 17,
    caption: "Tail Gunner assistance and named backup takeover",
  },
];

/** The condensed rules, word for word, with each diagram where the document places it. */
export const GUIDE_RULES: GuideRule[] = [
  {
    number: 1,
    title: "Why We Have Road Rules",
    blocks: [
      {
        kind: "para",
        text: "Safety. A pack is always changing: speed, weather, traffic, road surface, fatigue, visibility and rider experience can all shift quickly, and what one rider does affects everyone. These rules keep the pack predictable. Pack safety comes before ego, pressure or personal preference.",
      },
      {
        kind: "para",
        text: "On a Club-led ride they apply to every rider in the pack: patched members, FNGs, supporters, guests and visiting riders. Social rides are covered in Rule 4.",
      },
      {
        kind: "para",
        text: "Road law applies at all times. Traffic controls and lawful directions from police or other authorised people apply throughout every ride. No club role, signal or procedure in these rules gives right of way, permission to exceed a speed limit or authority over other road users. If a club instruction cannot be followed safely and lawfully, protect yourself and others, then raise it at the next safe stop.",
      },
    ],
  },
  {
    number: 2,
    title: "Road Captain Runs the Ride",
    blocks: [
      {
        kind: "para",
        text: "From the ride brief until the ride is called done or handed over, the Road Captain (RC) has operational control of the pack: route, pace, staging, moving off, formation, lane changes, passing, stops, regroups, Officers and other ride roles, and safety calls for the conditions on the day.",
      },
      {
        kind: "para",
        text: "The RC may change the plan or route, adjust formation, split or stop the pack, cancel the ride or move a rider out of the main pack when safety requires it.",
      },
      {
        kind: "para",
        text: "The RC sets the meet point and departure time and gives riders as much notice as practical. If the RC cannot attend, an Acting RC is appointed for the ride or leg, with the same authority.",
      },
      {
        kind: "para",
        text: "The RC deals with the immediate safety issue on the road. The Sergeant at Arms (SAA), Chapter Executive or NEC handles any conduct follow-up under the club's usual processes. Raise concerns respectfully at a safe stop or after the ride.",
      },
    ],
  },
  {
    number: 3,
    title: "Ride Roles",
    blocks: [
      {
        kind: "para",
        text: "The ride brief names who fills each role. If the RC cannot continue, the appointed Acting RC takes over; if none has been appointed, the designated senior rider gets the pack safe and resets the ride.",
      },
      {
        kind: "bullet",
        text: "RC — Road Captain: runs the ride; controls route, pace, formation, signals and safety calls.",
      },
      {
        kind: "bullet",
        text: "W — Wing: normally the President or senior executive. First left wheel track, staggered behind the RC. Helps set spacing and steady the front; does not overrule the RC.",
      },
      {
        kind: "bullet",
        text: "O — Officer: deployed by the RC to help with communication, intersections, traffic points, lane changes and pack movement.",
      },
      {
        kind: "bullet",
        text: "Officer acting as Blocker: a task the RC gives an Officer, not a separate position. When not deployed, rides in the assigned Officer position.",
      },
      {
        kind: "bullet",
        text: "Corner Marker: used only when called by the RC; follows the briefed positioning and return procedure.",
      },
      {
        kind: "bullet",
        text: "TG — Tail Gunner: last motorcycle. Watches the rear and responds when a rider drops out or needs help.",
      },
      {
        kind: "bullet",
        text: "Backup TG: named in the brief. Takes over the rear when the TG stops to assist, cannot continue or leaves the pack. The handover is made clear to the RC and pack by the briefed communication method.",
      },
      {
        kind: "bullet",
        text: "M, S and T: members, supporters, FNGs, guests, newer riders, trikes and sidecars ride where the RC assigns them.",
      },
      { kind: "diagram", id: "roles" },
    ],
  },
  {
    number: 4,
    title: "Club Led Rides and Social Riding",
    blocks: [
      {
        kind: "para",
        text: "A Club-led ride is an organised Rustnuts ride run by an RC or Acting RC, and its status is made clear before departure. Formal procedures apply to Big 4 rides, official club calendar rides, formal chapter rides, rides posted or promoted as organised Rustnuts SMC rides, and public, charity, memorial or event rides where Rustnuts rides as an organised group.",
      },
      {
        kind: "para",
        text: "On public, charity and memorial rides, patched Rustnuts riders stay together in the lead Rustnuts group unless the RC directs otherwise. The RC explains how the group fits within the wider event.",
      },
      {
        kind: "para",
        text: "Social rides follow general safety and conduct rules, not the full pack structure. If a social ride is to become Club-led, the leader, procedures and brief must be made clear.",
      },
      {
        kind: "para",
        text: "Wearing Rustnuts colours means representing the club. Respect other road users and look after one another.",
      },
    ],
  },
  {
    number: 5,
    title: "Before the Ride",
    blocks: [
      {
        kind: "para",
        text: "KSU (Kick Stands Up) means the pack leaves at the stated time. Arrive early enough to fuel up, check the bike, sort your gear and hear the brief; do not make the pack wait. If you need help checking the bike, ask before ride time.",
      },
      {
        kind: "bullet",
        text: "Correct motorcycle licence, with its conditions complied with.",
      },
      {
        kind: "bullet",
        text: "Registered, roadworthy and suitable motorcycle.",
      },
      {
        kind: "bullet",
        text: "Tyres and tread, pressures, brakes and pads, lights, indicators, mirrors, fluids and controls checked.",
      },
      {
        kind: "bullet",
        text: "Enough fuel for the leg; know the planned fuel stops.",
      },
      {
        kind: "bullet",
        text: "Proper riding gear; anything carried is secured.",
      },
      {
        kind: "bullet",
        text: "Not affected by alcohol, drugs, medication, fatigue, illness or any other condition that makes riding unsafe.",
      },
      {
        kind: "para",
        text: "If you or your bike are not safe to ride, do not join the pack. Tell the RC about anything that may need a different position, pace or plan.",
      },
    ],
  },
  {
    number: 6,
    title: "Ride Brief",
    blocks: [
      {
        kind: "para",
        text: "The RC gives the brief before every Club-led ride. Listen, and ask about anything unclear before we roll. The RC can update the plan at a safe stop. The brief covers:",
      },
      {
        kind: "bullet",
        text: "Whether the ride is Club-led or social, and who is running it.",
      },
      {
        kind: "bullet",
        text: "Route, destination, planned stops, fuel stops and regroup points.",
      },
      {
        kind: "bullet",
        text: "Road, traffic, weather and other safety issues.",
      },
      {
        kind: "bullet",
        text: "Formation, and positions for newer riders, FNGs, guests, trikes and sidecars.",
      },
      {
        kind: "bullet",
        text: "Officers, any blocking or corner-marking tasks, the TG and the named backup TG.",
      },
      {
        kind: "bullet",
        text: "Lane changes: the normal snake method and any protected alternative. A different protected sequence must be briefed before it is used.",
      },
      {
        kind: "bullet",
        text: "Passing expectations, the RC arm-up signal and the abort procedure.",
      },
      { kind: "bullet", text: "Any Free Ride Section and its regroup point." },
      {
        kind: "bullet",
        text: "Single file, controlled stopping and any short, low-speed axle-to-axle section.",
      },
      {
        kind: "bullet",
        text: "The keep-left return path for deployed riders.",
      },
      {
        kind: "bullet",
        text: "Support-vehicle route and meeting arrangements.",
      },
      {
        kind: "bullet",
        text: "Readiness check, signals, communication, and breakdown and emergency arrangements. Any light use must be lawful.",
      },
    ],
  },
  {
    number: 7,
    title: "Formation and Position Order",
    blocks: [
      {
        kind: "para",
        text: "Normal starting order. The RC assigns individual positions by rider ability, conditions and the needs of the ride, and may adjust the order for safety. Patch seniority does not set position.",
      },
      { kind: "bullet", text: "RC — leads in the right wheel track." },
      { kind: "bullet", text: "W — first in the left wheel track." },
      {
        kind: "bullet",
        text: "O — Officers, including any Blockers when not deployed.",
      },
      { kind: "bullet", text: "Executive Board." },
      {
        kind: "bullet",
        text: "M — patched members, placed by ability and conditions.",
      },
      {
        kind: "bullet",
        text: "S — supporters, FNGs, guests and newer riders, as assigned.",
      },
      { kind: "bullet", text: "T — trikes and sidecars, as assigned." },
      {
        kind: "bullet",
        text: "TG — last motorcycle. The named backup TG is positioned as briefed.",
      },
      {
        kind: "para",
        text: "Know your position before moving off and keep it for the leg. Do not jump positions, overtake within the pack or swap wheel tracks. An Officer returning to position is a ride task, not permission for others to move up.",
      },
      { kind: "subheading", text: "Single File" },
      {
        kind: "para",
        text: "When the RC signals single file (road, visibility, bends or other conditions), form one line in the existing pack order. Make room progressively and keep safe spacing; nobody overtakes to join the line. On the RC's signal, return to the same staggered order and wheel tracks.",
      },
      { kind: "diagram", id: "formation" },
      { kind: "diagram", id: "single-file" },
    ],
  },
  {
    number: 8,
    title: "Staging Saddle Up and Moving Off",
    blocks: [
      {
        kind: "para",
        text: "When Saddle Up is called: get on, start up, end conversations, put the phone away, check mirrors and focus on the RC.",
      },
      {
        kind: "para",
        text: "Readiness check: when the RC looks to you and raises a hand, raise yours only when you are ready and hold it until acknowledged. If you are not ready, make that clear.",
      },
      {
        kind: "para",
        text: "The pack may leave staging two at a time, then settle into the briefed formation. The RC moves off steadily so nobody races to catch up. Late riders do not force into the pack; travel separately to the next stop unless the RC arranges otherwise.",
      },
    ],
  },
  {
    number: 9,
    title: "Staggered Riding and Axle to Axle Formation",
    blocks: [
      {
        kind: "para",
        text: "Staggered is the normal moving formation. Hold your wheel track, keep a steady pace and leave enough room to brake and avoid a hazard for the speed, weather, visibility, traffic, road surface and rider ability.",
      },
      {
        kind: "bullet",
        text: "If a gap opens in your track, fill forward smoothly when safe. No racing to close it and no slinky effect.",
      },
      {
        kind: "bullet",
        text: "No weaving, drifting between tracks or overtaking in the pack.",
      },
      {
        kind: "bullet",
        text: "Watch the road and mirrors, including for returning Officers.",
      },
      {
        kind: "bullet",
        text: "Do not pressure anyone to close a gap or ride beyond their ability.",
      },
      { kind: "bullet", text: "If the pack splits, stay safe and regroup." },
      {
        kind: "para",
        text: "The keep-left return procedure (Rule 13) overrides track-holding and gap-filling while it is in effect.",
      },
      { kind: "subheading", text: "Axle to Axle" },
      {
        kind: "para",
        text: "Permitted only when coming to or at a controlled stop, or on a short, low-speed section briefed beforehand and called by the RC, with briefed entry and exit signals. It reduces room to react, so it is used only where conditions and riders allow. Keep the same order, and return to the same staggered order when moving off or when the section ends. Low speed or a rider drawing alongside is not a call to ride axle-to-axle.",
      },
      { kind: "diagram", id: "readiness" },
      { kind: "diagram", id: "axle-to-axle" },
    ],
  },
  {
    number: 10,
    title: "Cages and Support Vehicles",
    blocks: [
      {
        kind: "para",
        text: "Cars, utes, vans and other support vehicles always travel outside the motorcycle pack: either behind the TG with clear space, or separately to meet at the next stop or destination. Officers do not block for cages, and a support vehicle gets no priority or escort through lights, intersections or give-way points. Drivers follow road law and the agreed route independently.",
      },
      {
        kind: "bullet",
        text: "Know the route, destination and meeting arrangements before departure.",
      },
      {
        kind: "bullet",
        text: "Leave clear space behind the TG for deployed Officers to rejoin.",
      },
      {
        kind: "bullet",
        text: "Do not force into the pack, travel beside it or interfere with returning riders.",
      },
      {
        kind: "bullet",
        text: "Where practical, consolidate into fewer vehicles.",
      },
      { kind: "diagram", id: "support-vehicles" },
    ],
  },
  {
    number: 11,
    title: "Hand Signals and Road Hazards",
    blocks: [
      {
        kind: "para",
        text: "Know the signals explained in the brief. Signal only when safe and in control of the bike. Hand signals support, and never replace, indicators and your own checks.",
      },
      {
        kind: "bullet",
        text: "Pack signals pass rider to rider through to the TG. Hold the signal until the rider behind repeats it; do not assume a quick gesture was seen.",
      },
      {
        kind: "bullet",
        text: "RC-to-Officer signals are relayed only when the RC says so.",
      },
      {
        kind: "bullet",
        text: "The axle-to-axle signal applies only as set out in Rule 9.",
      },
      {
        kind: "bullet",
        text: "Hazard lights only where road law permits. A light display is not permission to pass, change lanes or ignore a traffic control.",
      },
      {
        kind: "bullet",
        text: "Hazards (potholes, gravel, roadkill, debris, oil, water, broken surfaces, stopped vehicles, pedestrians, animals): point with hand or foot on the hazard side and pass it back.",
      },
      {
        kind: "bullet",
        text: "Do not fixate on a signal or the bike ahead. If a signal is unclear, do not guess at anything that puts you at risk.",
      },
      { kind: "diagram", id: "signals-1" },
      { kind: "diagram", id: "signals-2" },
      { kind: "diagram", id: "signals-3" },
      { kind: "diagram", id: "pass-signal" },
    ],
  },
  {
    number: 12,
    title: "Passing and Single Lane All Clear",
    blocks: [
      {
        kind: "para",
        text: "The RC coordinates passing slower traffic. No one overtakes inside the pack or starts a pack pass without RC direction, unless immediate safety requires it. The RC controls the passing window; each rider is responsible for their own pass.",
      },
      { kind: "subheading", text: "The RC Arm Up Procedure" },
      {
        kind: "para",
        text: "On a road with one lane each way, the RC overtakes first when safe and, while ahead in the oncoming lane, may raise an arm to show the window is open, returning left when road law requires. The arm-up is advice, not a command or guarantee. Nobody has to pass because the rider ahead did; if unsure, wait.",
      },
      {
        kind: "bullet",
        text: "Waiting riders stay behind the slower vehicle in the left lane, usually in the right wheel track. Do not copy the RC's lane position.",
      },
      {
        kind: "bullet",
        text: "Pass one at a time, in pack order unless directed. Make your own mirror and shoulder checks, and check road markings, sight distance and oncoming traffic.",
      },
      {
        kind: "bullet",
        text: "Do not start a pass you cannot complete. Speed limits apply throughout.",
      },
      {
        kind: "bullet",
        text: "Return left once clear, leaving room for following riders. Do not crowd the vehicle or another rider's return space, or slow abruptly in front of the vehicle.",
      },
      {
        kind: "bullet",
        text: "Reform staggered once clear. When the TG is clear, settle into the RC's normal pace.",
      },
      {
        kind: "para",
        text: "On a large pack, Officers may relay the RC's signal as briefed. They cannot open a window themselves.",
      },
      { kind: "subheading", text: "Closing the Window and Aborting" },
      {
        kind: "para",
        text: "The window closes when the RC lowers the arm and returns left. If a pass becomes unsafe, the RC, Acting RC or any Officer gives a clear abort signal (preferred: arm pointing back to the correct lane). An Officer does not need an RC instruction to warn the pack.",
      },
      {
        kind: "bullet",
        text: "Not committed: stay behind, or safely drop back behind, the vehicle.",
      },
      {
        kind: "bullet",
        text: "Already committed: complete or abort based on the actual conditions and space. No blind swerving or braking because a signal was given.",
      },
      {
        kind: "para",
        text: "Repeat when another safe opportunity opens, until the pack has passed or the RC changes the plan. If separated, ride safely and regroup.",
      },
      { kind: "diagram", id: "arm-up" },
      { kind: "diagram", id: "abort" },
    ],
  },
  {
    number: 13,
    title: "Turns Intersections and Return Paths",
    blocks: [
      {
        kind: "para",
        text: "The RC controls the approach to turns, intersections, roundabouts and traffic points. Officers, Blockers and Corner Markers deploy only on the RC's call, using the briefed procedure. These roles carry no authority to stop or direct traffic, run a light or make anyone give way. If lights or traffic split the pack, continue safely and regroup.",
      },
      {
        kind: "bullet",
        text: "Inside-track riders hold a controlled inside line; outside-track riders square the turn where practical.",
      },
      {
        kind: "bullet",
        text: "Do not cut across or crowd another rider's line. Do not change tracks mid-turn unless safety requires it.",
      },
      {
        kind: "bullet",
        text: "Deployed Officers position clear of the pack's path; riders stay aware of where they are.",
      },
      { kind: "subheading", text: "Keep Left for Returning Riders" },
      {
        kind: "para",
        text: "After passing a deployed Officer, Blocker or Corner Marker, move progressively to the left wheel track when safe and hold it, leaving the right track clear for them to return towards the front. This overrides normal track-holding and gap-filling. Do not crowd another bike, drift right or accelerate unpredictably while they return.",
      },
      {
        kind: "para",
        text: "The returning rider checks before rejoining and goes back to their assigned position. A clear right track is not permission for an unsafe pass or unlawful use of another lane. Reform staggered once returning riders are clear and the RC permits. The RC briefs the return method and signals.",
      },
      { kind: "diagram", id: "turning" },
      { kind: "diagram", id: "keep-left" },
    ],
  },
  {
    number: 14,
    title: "Lane Changes Using the Snake Method",
    blocks: [
      {
        kind: "para",
        text: "The normal Rustnuts lane change. The RC checks the new lane, signals and moves first. Riders follow progressively in pack order, front to back, passing the signal back.",
      },
      {
        kind: "bullet",
        text: "Every rider indicates, checks mirrors and shoulder, and gives way. A rider ahead moving does not make it safe for you.",
      },
      {
        kind: "bullet",
        text: "No moving early, racing, jumping position or drifting between lanes.",
      },
      {
        kind: "bullet",
        text: "Once committed, no hard braking or hesitation without a safety reason. Do not rush a gap or pull alongside another rider.",
      },
      {
        kind: "bullet",
        text: "No safe gap: wait. If traffic splits the pack, finish your move safely and regroup.",
      },
    ],
  },
  {
    number: 15,
    title: "Lane Changes Using the Protected Method",
    blocks: [
      {
        kind: "para",
        text: "A briefed alternative to the snake method. The RC calls it and assigns the Officer acting as Blocker; the brief sets out the sequence, signals and return path.",
      },
      {
        kind: "bullet",
        text: "The Officer enters the new lane first when safe. The pack holds formation until the correct signal and its place in the sequence.",
      },
      {
        kind: "bullet",
        text: "Normally pass the blocking Officer before changing lanes, unless the RC has clearly briefed a different sequence. Do not improvise.",
      },
      {
        kind: "bullet",
        text: "The Officer may be slower than the pack. Keep a safe distance and make your own checks before moving.",
      },
      {
        kind: "bullet",
        text: "No forcing a gap, obstructing or slowing other traffic.",
      },
      {
        kind: "bullet",
        text: "The Officer then returns as directed; keep the right track clear if keep-left is used. If the move cannot be completed safely, wait, abandon it or regroup as directed.",
      },
      { kind: "diagram", id: "snake" },
      { kind: "diagram", id: "protected" },
    ],
  },
  {
    number: 16,
    title: "Free Ride Sections",
    blocks: [
      {
        kind: "para",
        text: "Only when the RC clearly declares one and names the regroup point. Pack formation is suspended; ride your own safe pace and spacing within your ability. The RC can end it at any time for traffic, weather, rider behaviour or safety.",
      },
      {
        kind: "bullet",
        text: "No racing, showing off or dangerous overtaking.",
      },
      {
        kind: "bullet",
        text: "No pressure to keep up or ride beyond your skill.",
      },
      {
        kind: "bullet",
        text: "Look after one another and leave room for other road users.",
      },
      {
        kind: "bullet",
        text: "Reform at the regroup point under the RC's direction.",
      },
    ],
  },
  {
    number: 17,
    title: "Stops Regroups Breakdowns and Emergencies",
    blocks: [
      {
        kind: "para",
        text: "The RC controls stops and regroups. Get everyone clear of traffic first; once off the road, keep moving far enough to leave room for the riders behind.",
      },
      {
        kind: "bullet",
        text: "Do not block entrances, exits, intersections, fuel bowsers or public access.",
      },
      {
        kind: "bullet",
        text: "Reverse park on an angle where practical so the pack can leave cleanly.",
      },
      {
        kind: "bullet",
        text: "If separated, use the briefed stop or regroup point. Do not speed to catch up.",
      },
      { kind: "bullet", text: "Reform under the RC's direction." },
      {
        kind: "para",
        text: "If a rider drops out, breaks down, becomes unwell or has an emergency, stay calm and predictable. The TG responds unless the rider clearly signals help is not needed. Do not have several riders drop out because a mate has stopped. The named backup TG takes over the rear using the briefed handover; if the TG has trouble, the backup responds. Tell the RC when safe; the RC manages the pack, rear coverage and regroup.",
      },
      {
        kind: "para",
        text: "Rustnuts does not leave a rider behind alone, and does not stop the whole pack in an unsafe place. In an emergency, get help, follow emergency-service directions and keep others out of danger.",
      },
      {
        kind: "para",
        text: "At a police stop, follow lawful directions. The RC and senior executive handle club-level communication; each rider responds to directions and requests that apply to them.",
      },
      { kind: "diagram", id: "tail-gunner" },
    ],
  },
  {
    number: 18,
    title: "If Someone Does Not Follow the Rules",
    blocks: [
      {
        kind: "para",
        text: "The RC deals with an on-road safety problem straight away. That may mean moving the rider, placing them near an experienced rider, sending them outside the main pack, stopping their participation, stopping the pack or ending the ride.",
      },
      {
        kind: "para",
        text: "If a rider's skills are not yet sufficient for the pack, the RC offers optional practice and support. Readiness to rejoin is judged on riding ability and safety alone, whether or not the support was taken up.",
      },
      {
        kind: "para",
        text: "Attitude, repeated unsafe riding, disrespect or conduct that reflects badly on Rustnuts can be referred to the SAA and the club process once the immediate issue is managed.",
      },
      {
        kind: "para",
        text: "Do not argue while riding. Follow the direction and raise concerns respectfully at the next safe stop, after the ride or with the SAA.",
      },
      {
        kind: "para",
        text: "By joining a Club-led ride, each rider accepts responsibility for reading, understanding and following these Road Rules and the ride brief.",
      },
      { kind: "para", text: "Much Love, Rust, Honour and Respect." },
    ],
  },
];

export function diagramById(id: string): RulesDiagram | undefined {
  return DIAGRAMS.find((d) => d.id === id);
}

/** "Rule 12 · Closing the passing window and aborting". */
export const diagramLabel = (d: RulesDiagram): string =>
  `Rule ${d.rule} · ${d.caption}`;

/** The diagrams in the order the condensed rules show them. */
const placed: DiagramId[] = GUIDE_RULES.flatMap((r) =>
  r.blocks.flatMap((b) => (b.kind === "diagram" ? [b.id] : [])),
);

/** The figure number the condensed document gives a diagram (Figure 1 to 17). */
export function figureNumber(id: DiagramId): number {
  return placed.indexOf(id) + 1;
}

/** The rules whose text shows this diagram. */
export function rulesWithDiagram(id: DiagramId): number[] {
  return GUIDE_RULES.filter((r) =>
    r.blocks.some((b) => b.kind === "diagram" && b.id === id),
  ).map((r) => r.number);
}

/** The diagrams either side of this one, in the diagrams-only order. */
export function neighbours(id: DiagramId): {
  prev: DiagramId | null;
  next: DiagramId | null;
} {
  const i = DIAGRAMS.findIndex((d) => d.id === id);
  return {
    prev: DIAGRAMS[i - 1]?.id ?? null,
    next: DIAGRAMS[i + 1]?.id ?? null,
  };
}

export function ruleByNumber(n: number): GuideRule | undefined {
  return GUIDE_RULES.find((r) => r.number === n);
}

/** The rules either side of this one. */
export function ruleNeighbours(n: number): {
  prev: number | null;
  next: number | null;
} {
  return {
    prev: ruleByNumber(n - 1) ? n - 1 : null,
    next: ruleByNumber(n + 1) ? n + 1 : null,
  };
}
