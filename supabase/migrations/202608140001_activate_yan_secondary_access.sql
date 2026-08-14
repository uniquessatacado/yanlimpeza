-- Keep operational data shared between active Yan Limpeza staff.
-- Restrict the team directory so agents can only read their own profile.
-- User creation and activation are operational actions and are intentionally
-- not stored in this public repository.

drop policy if exists yan_profiles_select on public.yan_profiles;

create policy yan_profiles_select
on public.yan_profiles
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select yan_private.yan_is_admin())
);
