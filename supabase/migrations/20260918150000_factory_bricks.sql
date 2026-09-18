-- Creative Factory — registre des BRIQUES (composants scorables) et des RECETTES (créas assemblées).
-- Additif et interne : RLS owner/dev uniquement (service_role bypasse). Aucune donnée existante touchée.
-- Base du « tableau des IDs » (usage_count + score) et du statut Réussie/En cours/En attente (JARVIS).

create table if not exists public.factory_bricks (
  id           text primary key,                      -- ex. 'TX-O01' (posé à l'ingestion)
  kind         text not null,                          -- transformation|hook|liaison|contenu|cta|avatar|musique|sous-titre
  subject      text,                                   -- omni|motion-control|image-ia|mcp-claude|montage-ia|nettoyage-audio|express|trackads|general
  label        text,
  meta         jsonb not null default '{}'::jsonb,     -- fichiers, avant/après, ratio, durée, rotation, avatar…
  usage_count  int  not null default 0,
  samples      int  not null default 0,                -- nb de distributions ayant crédité cette brique
  score        numeric,                                -- Winner Radar (null tant que < min échantillons)
  score_state  text,                                   -- 'green'|'yellow'|'red'|null
  status       text not null default 'ready',          -- ready|flagged|retired
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.factory_recipes (
  id           text primary key,                      -- ex. 'HK-O01-02a'
  kind         text not null default 'hook',           -- hook|creative
  subject      text,
  components   jsonb not null default '[]'::jsonb,     -- [{slot:'A', brick_id:'TX-O01'}, …] ORDONNÉ
  params       jsonb not null default '{}'::jsonb,     -- voice|lang|format|durations…
  status       text not null default 'pending',        -- done|in_progress|pending  (Réussie/En cours/En attente)
  render_url   text,
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists factory_bricks_kind_subject_idx on public.factory_bricks (kind, subject);
create index if not exists factory_recipes_status_idx      on public.factory_recipes (status);

alter table public.factory_bricks  enable row level security;
alter table public.factory_recipes enable row level security;

-- owner/dev only (service_role bypasse la RLS) — mêmes conditions que le reste de l'app
drop policy if exists factory_bricks_owner  on public.factory_bricks;
drop policy if exists factory_recipes_owner on public.factory_recipes;
create policy factory_bricks_owner on public.factory_bricks for all
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and (coalesce(p.is_owner,false) or lower(coalesce(p.plan,''))='developer')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and (coalesce(p.is_owner,false) or lower(coalesce(p.plan,''))='developer')));
create policy factory_recipes_owner on public.factory_recipes for all
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and (coalesce(p.is_owner,false) or lower(coalesce(p.plan,''))='developer')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and (coalesce(p.is_owner,false) or lower(coalesce(p.plan,''))='developer')));

-- ── Seed : unités de transformation OMNI (tag 18/09) ──
insert into public.factory_bricks (id, kind, subject, label, meta) values
  ('TX-O01','transformation','omni','Audi → Lamborghini Urus',
   '{"before":{"label":"Audi A3","file":"OMNI/Vidéo 1.1.MP4","rotation":-90},"after":{"label":"Lamborghini Urus","file":"OMNI/Vidéo 1.mp4"},"ratio":"9:16"}'::jsonb),
  ('TX-O02a','transformation','omni','Clio → Porsche 911',
   '{"before":{"label":"Renault Clio","file":"OMNI/Vidéo 2.mp4"},"after":{"label":"Porsche 911 GT3","file":"OMNI/Vidéo 2.1.mp4"},"ratio":"9:16"}'::jsonb),
  ('TX-O02b','transformation','omni','Clio → Ford Mustang',
   '{"before":{"label":"Renault Clio","file":"OMNI/Vidéo 2.mp4"},"after":{"label":"Ford Mustang","file":"OMNI/Vidéo 2.2.mp4"},"ratio":"9:16","excludes":["TX-O02a"]}'::jsonb),
  ('TX-O03','transformation','omni','Bracelet fitness → Patek Philippe',
   '{"before":{"label":"Bracelet fitness","file":"OMNI/Vidéo 3.MOV","rotation":-90},"after":{"label":"Patek Philippe Nautilus","file":"OMNI/Vidéo 3.1.mp4"},"ratio":"9:16"}'::jsonb)
on conflict (id) do update set label=excluded.label, meta=excluded.meta, updated_at=now();

-- ── Seed : hooks assemblés RENDUS le 18/09 → status 'done' ──
insert into public.factory_recipes (id, kind, subject, components, status) values
  ('HK-O01-02a','hook','omni','[{"slot":"A","brick_id":"TX-O01"},{"slot":"B","brick_id":"TX-O02a"}]'::jsonb,'done'),
  ('HK-O02a-01','hook','omni','[{"slot":"A","brick_id":"TX-O02a"},{"slot":"B","brick_id":"TX-O01"}]'::jsonb,'done'),
  ('HK-O01-03','hook','omni','[{"slot":"A","brick_id":"TX-O01"},{"slot":"B","brick_id":"TX-O03"}]'::jsonb,'done'),
  ('HK-O03-01','hook','omni','[{"slot":"A","brick_id":"TX-O03"},{"slot":"B","brick_id":"TX-O01"}]'::jsonb,'done'),
  ('HK-O02a-03','hook','omni','[{"slot":"A","brick_id":"TX-O02a"},{"slot":"B","brick_id":"TX-O03"}]'::jsonb,'done'),
  ('HK-O03-02a','hook','omni','[{"slot":"A","brick_id":"TX-O03"},{"slot":"B","brick_id":"TX-O02a"}]'::jsonb,'done'),
  ('HK-O01-02b','hook','omni','[{"slot":"A","brick_id":"TX-O01"},{"slot":"B","brick_id":"TX-O02b"}]'::jsonb,'done'),
  ('HK-O02b-03','hook','omni','[{"slot":"A","brick_id":"TX-O02b"},{"slot":"B","brick_id":"TX-O03"}]'::jsonb,'done')
on conflict (id) do update set components=excluded.components, status=excluded.status, updated_at=now();
