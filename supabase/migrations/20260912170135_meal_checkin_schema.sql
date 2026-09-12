create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null,
  description text not null,
  created_at timestamptz not null default now()
);

create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_id uuid references public.meals(id) on delete cascade,
  kind text not null default 'post_meal' check (kind = 'post_meal'),
  due_at timestamptz not null,
  completed_at timestamptz,
  superseded_by uuid references public.check_ins(id) on delete set null,
  stomach_pain boolean,
  heartburn boolean,
  bloating boolean,
  bowel_issues boolean,
  general_wellbeing boolean,
  dry_mouth boolean,
  created_at timestamptz not null default now()
);

alter table public.meals enable row level security;
alter table public.check_ins enable row level security;

create policy "meals_select_own" on public.meals for select using (auth.uid() = user_id);
create policy "meals_insert_own" on public.meals for insert with check (auth.uid() = user_id);
create policy "meals_update_own" on public.meals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "meals_delete_own" on public.meals for delete using (auth.uid() = user_id);

create policy "check_ins_select_own" on public.check_ins for select using (auth.uid() = user_id);
create policy "check_ins_insert_own" on public.check_ins for insert with check (auth.uid() = user_id);
create policy "check_ins_update_own" on public.check_ins for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "check_ins_delete_own" on public.check_ins for delete using (auth.uid() = user_id);
