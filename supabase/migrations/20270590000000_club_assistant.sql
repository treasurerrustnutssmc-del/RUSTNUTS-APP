-- Ask the club (the club AI assistant): who may ask, how many a day, the club's monthly budget, and
-- the texts it answers from. The ask-club Edge Function calls assistant_start() as the member before
-- each question and assistant_spent() with the service role after it. No question text is ever kept:
-- only today's count per member (cleared after two days) and the club's month, with no names.
-- Spec: docs/superpowers/specs/2026-10-31-club-assistant-design.md
-- Switched off until private.app_settings 'assistant_on' is 'true' (and the function has its key).

create table if not exists private.assistant_days (
  member_id uuid not null,
  day date not null,
  questions int not null default 0 check (questions >= 0),
  primary key (member_id, day)
);
create table if not exists private.assistant_months (
  month date primary key check (extract(day from month) = 1),
  questions int not null default 0 check (questions >= 0),
  spent_microusd bigint not null default 0 check (spent_microusd >= 0)
);
revoke all on private.assistant_days, private.assistant_months from public, anon, authenticated;
alter table private.assistant_days enable row level security;
alter table private.assistant_months enable row level security;

create or replace function private.assistant_setting(p_key text, p_default bigint)
returns bigint language sql stable security definer set search_path = '' as $$
  -- A value that isn't a whole number is ignored, so a typo in a setting can't break every question.
  select coalesce((select trim(value)::bigint from private.app_settings where key = p_key and trim(value) ~ '^[0-9]{1,15}$'), p_default);
$$;

create or replace function private.assistant_on()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select value = 'true' from private.app_settings where key = 'assistant_on'), false);
$$;

-- The first day of the Melbourne month after p_day, for the "resting until" words.
create or replace function private.assistant_next_month(p_day date)
returns date language sql immutable set search_path = '' as $$
  select (date_trunc('month', p_day) + interval '1 month')::date;
$$;

-- Before each question, as the member: refuses with the words the app shows, counts the question,
-- and hands back the constitution's latest version and the latest Road Rules.
create or replace function public.assistant_start()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  today constant date := private.club_date();
  this_month constant date := date_trunc('month', private.club_date())::date;
  daily_limit constant bigint := private.assistant_setting('assistant_daily_limit', 15);
  budget constant bigint := private.assistant_setting('assistant_month_budget_microusd', 20000000);
  asked int;
  spent bigint;
  constitution jsonb;
  road_rules jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if not private.is_approved_member() then
    raise exception 'Only approved members can ask the club.';
  end if;
  if not private.assistant_on() then
    raise exception 'Ask the club isn’t switched on yet.';
  end if;

  -- Nothing about who asked lingers: yesterday's count is kept for the day boundary, older goes.
  delete from private.assistant_days where day < today - 1;

  select questions into asked from private.assistant_days where member_id = auth.uid() and day = today for update;
  if coalesce(asked, 0) >= daily_limit then
    raise exception 'You’ve asked % today. More tomorrow.', daily_limit;
  end if;
  -- Locked, so questions asked at the same moment near the cap queue here rather than all slip through.
  select spent_microusd into spent from private.assistant_months where month = this_month for update;
  if coalesce(spent, 0) >= budget then
    raise exception 'Ask the club is resting until %: this month’s budget is used.',
      to_char(private.assistant_next_month(today), 'DD/MM/YYYY');
  end if;

  insert into private.assistant_days as d (member_id, day, questions) values (auth.uid(), today, 1)
  on conflict (member_id, day) do update set questions = d.questions + 1;
  insert into private.assistant_months as m (month, questions) values (this_month, 1)
  on conflict (month) do update set questions = m.questions + 1;

  select jsonb_build_object('label', v.label, 'body', v.body) into constitution
  from public.document_versions v join public.documents d on d.id = v.document_id
  where d.kind = 'constitution' order by v.number desc limit 1;
  select jsonb_build_object('number', r.number, 'body', r.body) into road_rules
  from public.road_rules_versions r order by r.number desc limit 1;

  return jsonb_build_object('constitution', constitution, 'road_rules', road_rules);
end;
$$;

-- After each answer, with the service role: what it cost, in millionths of a US dollar.
create or replace function public.assistant_spent(p_microusd bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  this_month constant date := date_trunc('month', private.club_date())::date;
begin
  if p_microusd is null or p_microusd < 0 then
    raise exception 'The cost can’t be negative.';
  end if;
  insert into private.assistant_months as m (month, spent_microusd) values (this_month, p_microusd)
  on conflict (month) do update set spent_microusd = m.spent_microusd + excluded.spent_microusd;
end;
$$;

-- What the Home row and the screen show: on or off, questions left today, and (for the NEC) the
-- month's spend against the budget.
create or replace function public.assistant_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  today constant date := private.club_date();
  this_month constant date := date_trunc('month', private.club_date())::date;
  daily_limit constant bigint := private.assistant_setting('assistant_daily_limit', 15);
  budget constant bigint := private.assistant_setting('assistant_month_budget_microusd', 20000000);
  asked int;
  spent bigint;
  month_questions int;
  answer jsonb;
begin
  if not private.is_approved_member() then
    return jsonb_build_object('on', false, 'left_today', 0, 'daily_limit', daily_limit, 'resting_until', null);
  end if;
  select questions into asked from private.assistant_days where member_id = auth.uid() and day = today;
  select m.spent_microusd, m.questions into spent, month_questions from private.assistant_months m where m.month = this_month;
  answer := jsonb_build_object(
    'on', private.assistant_on(),
    'left_today', greatest(daily_limit - coalesce(asked, 0), 0),
    'daily_limit', daily_limit,
    'resting_until', case when coalesce(spent, 0) >= budget then to_char(private.assistant_next_month(today), 'DD/MM/YYYY') end);
  if private.is_national() then
    answer := answer || jsonb_build_object(
      'spent_microusd', coalesce(spent, 0), 'budget_microusd', budget, 'questions', coalesce(month_questions, 0));
  end if;
  return answer;
end;
$$;

revoke all on function public.assistant_start(), public.assistant_spent(bigint), public.assistant_status() from public, anon, authenticated;
revoke all on function private.assistant_setting(text, bigint), private.assistant_on(), private.assistant_next_month(date) from public, anon, authenticated;
grant execute on function public.assistant_start(), public.assistant_status() to authenticated;
grant execute on function public.assistant_spent(bigint) to service_role;
