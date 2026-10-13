-- 13/10 — filet « crédits rendus à la réserve, jamais remboursés » (images OpenAI / Google, soumissions Veo et Hedra).
-- Quand l'appel fournisseur échoue, le proxy REND le tirage à la réserve de l'op (releaseOp) au lieu de la rembourser : l'app
-- peut s'en resservir pour son repli (Nano → gpt-image…) puis rembourse elle-même ce qui reste (creditsFlowRefund). Onglet
-- fermé à ce moment-là → l'op restait intacte, jamais remboursée. Le proxy note désormais chaque libération ici ; le passage
-- releasePass de reconcile-fal-orphans (30 min) rembourse l'op si elle est toujours INTACTE (ni réglée, ni remboursée, ni liée
-- à un job, réserve = montant) — via refund_op_terminal (cas propre seulement, gel à 2 h). Service_role seul.
create table if not exists public.release_watch (
  op_id       uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  proxy       text not null check (proxy in ('openai', 'google', 'hedra')),
  released_at timestamptz not null default now(),
  closed_at   timestamptz,
  outcome     text
);
create index if not exists release_watch_open_idx on public.release_watch (released_at) where closed_at is null;
alter table public.release_watch enable row level security;
revoke all on table public.release_watch from public, anon, authenticated;
grant select, insert, update, delete on table public.release_watch to service_role;
