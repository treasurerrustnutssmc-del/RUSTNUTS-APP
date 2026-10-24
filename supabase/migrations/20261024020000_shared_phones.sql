-- Every phone number the person asking is allowed to see, in one call, for the members directory:
-- their own, their chapter's (board), and anyone who chose to share with members.

create or replace function public.shared_phones()
returns table (member_id uuid, phone text)
language sql stable security definer set search_path = public as $$
  select mp.member_id, mp.phone
  from member_private mp
  join members m on m.id = mp.member_id
  where mp.phone is not null
    and (
      mp.member_id = auth.uid()
      or private.is_board_of(m.chapter_id)
      or (m.share_phone and m.approval = 'approved' and private.is_approved_member())
    );
$$;

revoke all on function public.shared_phones() from public, anon;
grant execute on function public.shared_phones() to authenticated;
