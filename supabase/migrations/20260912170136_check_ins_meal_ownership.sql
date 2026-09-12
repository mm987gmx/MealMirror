-- Fix: check_ins insert/update policies didn't validate that meal_id
-- belongs to the same user, allowing a check-in to reference another
-- user's meal (no read leak, but a referential-integrity gap).
drop policy "check_ins_insert_own" on public.check_ins;
drop policy "check_ins_update_own" on public.check_ins;

create policy "check_ins_insert_own" on public.check_ins for insert
  with check (
    auth.uid() = user_id
    and (meal_id is null or exists (select 1 from public.meals m where m.id = meal_id and m.user_id = auth.uid()))
  );

create policy "check_ins_update_own" on public.check_ins for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (meal_id is null or exists (select 1 from public.meals m where m.id = meal_id and m.user_id = auth.uid()))
  );
