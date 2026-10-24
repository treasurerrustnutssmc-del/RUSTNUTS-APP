-- Legacy: a member who left the club in good standing. They keep an approved record but no patch,
-- so they never get the MEMBER disc (that is earned at Full and kept by Nomads).
alter type public.member_status add value if not exists 'legacy';
