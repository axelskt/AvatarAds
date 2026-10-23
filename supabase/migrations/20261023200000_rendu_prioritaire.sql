-- 23/10/2026 (Axel) : « Rendu prioritaire » 5 €/mois, vendu sur la page de paiement (paiement.html) — abonnement Whop À PART,
-- posé / retiré par whop-webhook (secret WHOP_PRIO_PLANS). Les rendus des comptes concernés passent devant dans la file du
-- moteur (render-worker/securite.mjs prochainJob : compositions courtes → comptes prioritaires → les autres).
-- Les deux colonnes de profiles sont protégées d'office : profiles_guard n'autorise au client que first_name / phone /
-- affiliate_payment.
alter table public.profiles add column if not exists rendu_prioritaire boolean not null default false;
alter table public.profiles add column if not exists prio_member_id text;   -- abonnement Whop du rendu prioritaire (mem_…)

alter table public.render_jobs add column if not exists prioritaire boolean not null default false;
create index if not exists render_jobs_file_prioritaire on public.render_jobs (status, prioritaire, created_at);

-- posé à l'INSERTION d'après le compte, quel que soit le chemin (render-job, MCP…) : rien à changer chez les appelants,
-- et personne ne peut se l'attribuer en écrivant la colonne lui-même
create or replace function public.render_jobs_prioritaire() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.prioritaire := coalesce((select p.rendu_prioritaire from public.profiles p where p.id = new.user_id), false);
  return new;
end $$;
revoke all on function public.render_jobs_prioritaire() from public, anon, authenticated;
drop trigger if exists trg_render_jobs_prioritaire on public.render_jobs;
create trigger trg_render_jobs_prioritaire before insert on public.render_jobs
  for each row execute function public.render_jobs_prioritaire();
