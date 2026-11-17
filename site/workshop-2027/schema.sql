-- Supabase SQL Editor: change three placeholder emails privately before running.
-- Do NOT add real participant emails or any secret to the public GitHub repository.
create table if not exists public.workshop_allowed (
  email text primary key,
  participant_id text not null unique check (participant_id in ('p1','p2','p3'))
);
create table if not exists public.workshop_states (
  room text primary key,
  revision bigint not null default 0,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  constraint workshop_payload_object check (jsonb_typeof(payload) = 'object')
);
insert into public.workshop_states (room, revision, payload)
values ('team-2027', 0, '{"version":1,"updatedAt":0,"participants":[],"ideas":[],"deletedIds":[]}'::jsonb)
on conflict (room) do nothing;

-- Replace these three placeholders with the actual approved emails before execution.
insert into public.workshop_allowed(email,participant_id) values
 ('member1@example.com','p1'),
 ('member2@example.com','p2'),
 ('member3@example.com','p3')
on conflict(email) do update set participant_id=excluded.participant_id;

alter table public.workshop_allowed enable row level security;
alter table public.workshop_states enable row level security;

drop policy if exists "allowed_read_self" on public.workshop_allowed;
create policy "allowed_read_self" on public.workshop_allowed for select to authenticated
using (email = lower(auth.jwt() ->> 'email'));

drop policy if exists "states_read_three_members" on public.workshop_states;
create policy "states_read_three_members" on public.workshop_states for select to authenticated
using (room='team-2027' and exists (
  select 1 from public.workshop_allowed a
  where a.email=lower(auth.jwt() ->> 'email')
));

drop policy if exists "states_update_three_members" on public.workshop_states;
create policy "states_update_three_members" on public.workshop_states for update to authenticated
using (room='team-2027' and exists (
  select 1 from public.workshop_allowed a
  where a.email=lower(auth.jwt() ->> 'email')
))
with check (room='team-2027' and exists (
  select 1 from public.workshop_allowed a
  where a.email=lower(auth.jwt() ->> 'email')
));

revoke all on table public.workshop_allowed from anon,authenticated;
revoke all on table public.workshop_states from anon,authenticated;
grant select on table public.workshop_allowed to authenticated;
grant select,update on table public.workshop_states to authenticated;

-- RLS enabled + table privilege restricted. Verify with two browsers before real use.
