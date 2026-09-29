-- 30/09 (Axel : disque plein, « on stocke dans Supabase et une fois programmé / posté on les supprime ») : date à laquelle
-- le MP4 final d'un post a été retiré du stockage (la recette factory_posts.combo reste pour ré-assembler).
alter table public.factory_posts add column if not exists video_deleted_at timestamptz;
