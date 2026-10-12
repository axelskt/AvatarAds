-- 12/10 (Axel : « pourquoi il n'arrive toujours pas à détecter la bonne vidéo ? ») : texte choc LU sur la couverture
-- (vision) pour départager les vidéos de l'usine qui se ressemblent (même avatar, même pièce). null = pas encore lu.
alter table public.tiktok_videos add column if not exists cover_text text;
