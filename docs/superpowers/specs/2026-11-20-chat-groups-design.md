# Chat groups and the All boards chat (20 Nov 2026)

Architectural (new chat kinds and who the database lets into them), so a written spec. Claude
approved it; Jeff can veto.

## Jeff's ask

"where do i add a new chat group? can we add that feature and add a BOTH CHAPTER board chat?"

Until now there was nowhere: the chats are a fixed set (Whole club, Family, each chapter, each
chapter's big table, NEC, the two committees, ride chats, private one-to-one chats). The NEC chat is
the National officers and the Presidents only, so no chat held both boards.

## 1. All boards

One fixed chat called **All boards**, for every sitting board member of every chapter (acting holders
included, through `private.held_positions`) and the NEC. That is exactly `private.is_any_board()`, the
group that already moderates the whole-club chat, mirrored in the app by `isAnyBoard`.

- Nobody adds people: it follows the seats. Taking a seat puts you in; leaving one takes you out.
- Anyone in it moderates it (remove, pin), like each chapter's big table.
- Pushes are titled "All boards".
- It sits after the chapter big tables in the chat list, with the shield icon.

## 2. Group chats

A **New group** button in the chat list (next to New private chat), shown to board members and the NEC. A group has a name (1 to 40
characters) and its people.

- **Who starts one:** board members of any chapter and the NEC (`is_any_board()`, the same people as
  All boards). Jeff's tap, 20 Nov 2026 08:52Z: "Board and NEC only".
- **Who can be in one:** approved members FNG and up. Hang Arounds (Introduced) and Family can't be
  added, and the person adding can't add someone they've blocked or who has blocked them ("You can't
  add Bob."). At most 100 people.
- **In the group:** everyone in it reads, posts and can leave. Board members and the NEC who are in
  it add people, rename it and take people out. Nobody outside it sees it: not the board, not the NEC.
- **Content rules (Apple 1.2):** report and block work as in private chats. Nobody moderates a group
  (like a private chat), so a report goes to the reporter's chapter board, who can remove the message.
- **Photos:** a group's photos show in the Photos feed only for people in that group (the feed already
  only shows chats you can read). They never go on the website ("Photos from group chats stay private.").
- **Pushes:** titled with the group's name, "Rusty: words" in the body, like other group chats.
- The group's info page (tap the people icon in its header) lists who's in it, with Leave group for
  everyone, and for board members and the NEC Add people, Rename and a Take out button on each
  person (ConfirmButton, no Alert).

## Database

Two files, because Postgres can't use a new enum value in the transaction that adds it:

1. `20270880000000_chat_groups_kind.sql`: `chat_kind` gets `boards` and `group`.
2. `20270880000100_chat_groups.sql`:
   - `conversations.name` (groups only, checked) and `conversations.created_by`;
   - the one All boards conversation (unique index);
   - `chat_problem`: All boards for `is_any_board()`, groups for the people in them;
   - `can_moderate`: nobody in a group; `can_act_on_report`: groups like private chats;
   - `chat_list` carries `name` and `created_by`; `chat_push_title` names both;
   - `pick_site_photo` refuses group photos;
   - new `create_group_chat`, `add_to_group`, `rename_group`, `leave_group`, `remove_from_group`.

## App

- `ChatKind` gets `boards` and `group`; `Conversation` gets `name` and `createdBy`.
- `readProblem`, `canModerate`, `canSeeReport`, `chatTitle` mirror the database; new
  `groupNameProblem`, `groupAddProblem`, `createGroupProblem`, `addToGroupProblem`,
  `renameGroupProblem`, `leaveGroupProblem`, `removeFromGroupProblem` give the same words.
- Chat context gets `createGroup`, `addToGroup`, `renameGroup`, `leaveGroup`, `removeFromGroup`,
  in the demo and live.
- Screens: `NewGroup` (name, search, tick people, Start group) and `GroupInfo`.
- The demo gets All boards and one group ("Big 4 crew").

## Tests

`supabase/tests/chat_groups_test.sql` and the app rules in `src/domain/chat.test.ts` and
`src/data/chat/demoChatActions.test.ts`.

## Not in this

System lines in the chat ("Rusty added Bob"), group photos as avatars, muting one chat.
