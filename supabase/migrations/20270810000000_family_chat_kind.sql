-- Family chat, part 1 of 2. See docs/superpowers/specs/2026-11-03-family-chat-design.md.
-- A new kind of chat. On its own, because Postgres can't use a new enum value in the transaction
-- that adds it; 20270810000100_family_chat.sql does the rest.

alter type public.chat_kind add value if not exists 'family';
