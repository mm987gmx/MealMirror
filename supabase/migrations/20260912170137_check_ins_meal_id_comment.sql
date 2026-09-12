-- Documents why meal_id is nullable while `kind` is currently
-- constrained to 'post_meal' only: deliberately left open for S-02's
-- fixed daily check-ins (morning/evening), which are not meal-anchored.
comment on column public.check_ins.meal_id is
  'Nullable: post_meal check-ins reference the triggering meal; future kind values (S-02 morning/evening) are not meal-anchored and leave this null.';
