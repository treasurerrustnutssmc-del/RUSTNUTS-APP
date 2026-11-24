-- Topics inside board, committee and group chats, part 1 of 2. See
-- docs/superpowers/specs/2026-11-24-chat-topics-design.md. Postgres can't use a new enum value in the
-- transaction that adds it, so this goes in on its own run, before 20270980000100_chat_topics.sql.
alter type public.chat_kind add value if not exists 'topic';
