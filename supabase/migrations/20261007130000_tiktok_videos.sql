-- 07/10 : vidéos TikTok lues par tiktok-auth?action=stats (comptes reliés pour les stats). Une ligne par vidéo :
--  - cover_copy : copie de la couverture dans factory-media/tiktok-covers/ (le lien TikTok est signé et expire ; sur
--    Safari, une partie des couvertures ne s'affichait pas) ;
--  - cover_hash + vf + match_* : rapprochement avec la vidéo de l'usine (couverture par défaut = première image, comparée à
--    l'empreinte factory_fp de chaque vidéo finale, durée à 1 s près), automatique ou choisi à la main dans Factory V2.
-- Écrite et lue par l'edge tiktok-auth uniquement (service role) : RLS active, aucune policy, aucun droit client.
create table if not exists public.tiktok_videos (
  id           text primary key,
  account      text not null,
  env          text not null default 'sandbox' check (env in ('prod', 'sandbox')),
  created      timestamptz,
  duration     integer,
  title        text,
  share_url    text,
  cover_src    text,
  cover_copy   text,
  cover_hash   text,
  views        bigint,
  likes        bigint,
  comments     bigint,
  shares       bigint,
  vf           text,
  match_state  text check (match_state is null or match_state in ('auto', 'manual', 'unsure', 'none')),
  match_score  real,
  candidates   jsonb,
  updated_at   timestamptz not null default now()
);
create index if not exists tiktok_videos_account_idx on public.tiktok_videos (account, created desc);
alter table public.tiktok_videos enable row level security;
revoke all on table public.tiktok_videos from anon, authenticated, public;

-- Empreintes des vidéos finales de l'usine (usine/fingerprint.mjs) : dHash 256 bits à 0 s, 0,5 s et 1 s + durée.
create table if not exists public.factory_fp (
  video_url   text primary key,
  vf          text,
  duration    real,
  hashes      text[] not null,
  updated_at  timestamptz not null default now()
);
alter table public.factory_fp enable row level security;
revoke all on table public.factory_fp from anon, authenticated, public;

-- (même jour) lien de couverture renvoyé par TikTok, gardé pour diagnostic (signé, expire)
alter table public.tiktok_videos add column if not exists cover_src text;

-- (même jour) vignettes 54 × 96 en luminance, base64 (fpThumb), une par instant
alter table public.factory_fp add column if not exists thumbs text[];

-- (même jour) TikTok ne prend PAS la première image comme couverture (constaté sur @avatarads le 07/10 : avant/après déjà
-- ouvert, image incrustée, 3e mot du sous-titre) → empreintes sur les 10 premières secondes, 4 images par seconde.
-- coarse = vignette 18 × 32 (pré-tri), thumb = vignette 54 × 96 (score fin), base64.
create table if not exists public.factory_fp_frames (
  video_url  text not null,
  t          real not null,
  coarse     text not null,
  thumb      text not null,
  primary key (video_url, t)
);
alter table public.factory_fp_frames enable row level security;
revoke all on table public.factory_fp_frames from anon, authenticated, public;

-- (même jour) signatures de style couleur (fpStyleSet : histogrammes YCbCr, 4 fenêtres), base64, une par instant
alter table public.factory_fp add column if not exists styles text[];
