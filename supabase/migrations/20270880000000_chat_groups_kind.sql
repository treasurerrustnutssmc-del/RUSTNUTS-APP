-- Chat groups and the All boards chat, part 1 of 2. See docs/superpowers/specs/2026-11-20-chat-groups-design.md.
-- Two new kinds of chat. On their own, because Postgres can't use a new enum value in the transaction
-- that adds it; 20270880000100_chat_groups.sql does the rest.

alter type public.chat_kind add value if not exists 'boards';
alter type public.chat_kind add value if not exists 'group';
