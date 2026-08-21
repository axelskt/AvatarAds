-- Parrainage : `profiles.referred_by` stocke le CODE de parrainage (10 premiers hex de l'uuid du
-- parrain, en majuscules — cf. _affCode dans app/index.html), pas son uuid. Le compteur doit donc
-- accepter les deux formes. SECURITY DEFINER : un membre ne lit pas les profils des autres (RLS).
create or replace function public.get_referral_count()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
  from public.profiles p
  where p.id <> auth.uid()
    and (
      p.referred_by = auth.uid()::text
      or upper(p.referred_by) = upper(substr(replace(auth.uid()::text, '-', ''), 1, 10))
    );
$$;
revoke all on function public.get_referral_count() from public;
grant execute on function public.get_referral_count() to authenticated;
