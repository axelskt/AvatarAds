-- Creative Factory (Axel 25/09/2026) : 4 nouvelles démos Image IA dans la bibliothèque de briques (kind 'contenu').
-- DEUX familles à ne jamais mélanger à l'assemblage (règle : contenu.subject ∈ hook.compatible_subjects) :
--   · UGC réel (avatar photo réaliste)  → subject 'image-ia'   · C-IMGIA-06 / C-IMGIA-07 ;
--   · Static ads (« Pub Produit »)       → subject 'static-ads' · C-SADS-01 / C-SADS-02 (les 2 seules démos static ads).
-- meta.variant ('ugc-reel' | 'static-ads') le dit aussi explicitement ; les démos Image IA existantes sont des UGC réel.
insert into public.factory_bricks (id, kind, subject, label, meta, status) values
  ('C-IMGIA-06', 'contenu', 'image-ia', 'Démo Image IA · UGC réel (Démo Image IA 5)', jsonb_build_object(
     'file', 'W CRÉA/visite guidée/Image IA/Démo Image IA 5.mp4', 'media', 'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/demos/C-IMGIA-06.mp4',
     'media_type', 'video', 'variant', 'ugc-reel', 'duration_s', 38.4, 'resolution', '2160x3840', 'compatible_subjects', jsonb_build_array('image-ia')), 'ready'),
  ('C-IMGIA-07', 'contenu', 'image-ia', 'Démo Image IA · UGC réel (Démo image IA 6)', jsonb_build_object(
     'file', 'W CRÉA/visite guidée/Image IA/Démo image IA 6.mp4', 'media', 'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/demos/C-IMGIA-07.mp4',
     'media_type', 'video', 'variant', 'ugc-reel', 'duration_s', 38.4, 'resolution', '2160x3840', 'compatible_subjects', jsonb_build_array('image-ia')), 'ready'),
  ('C-SADS-01', 'contenu', 'static-ads', 'Démo Image IA · Static ads 1 (Pub Produit)', jsonb_build_object(
     'file', 'W CRÉA/visite guidée/Image IA/Démo Image IA Static Ads 1.mp4', 'media', 'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/demos/C-SADS-01.mp4',
     'media_type', 'video', 'variant', 'static-ads', 'module', 'image-ia', 'duration_s', 28.37, 'resolution', '2160x3840', 'compatible_subjects', jsonb_build_array('static-ads')), 'ready'),
  ('C-SADS-02', 'contenu', 'static-ads', 'Démo Image IA · Static ads 2 (Pub Produit)', jsonb_build_object(
     'file', 'W CRÉA/visite guidée/Image IA/Démo Image IA Static Ads 2.mp4', 'media', 'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/demos/C-SADS-02.mp4',
     'media_type', 'video', 'variant', 'static-ads', 'module', 'image-ia', 'duration_s', 28.37, 'resolution', '2160x3840', 'compatible_subjects', jsonb_build_array('static-ads')), 'ready')
on conflict (id) do update set kind = excluded.kind, subject = excluded.subject, label = excluded.label, meta = excluded.meta,
  status = excluded.status, updated_at = now();

-- Les démos Image IA déjà présentes (C-IMGIA-01 à 05) sont des UGC réel.
update public.factory_bricks set meta = meta || jsonb_build_object('variant', 'ugc-reel'), updated_at = now()
where kind = 'contenu' and id in ('C-IMGIA-01', 'C-IMGIA-02', 'C-IMGIA-03', 'C-IMGIA-04', 'C-IMGIA-05');

-- H77 « Créer des pubs produit avec un gros ROI » parle de PUBS PRODUIT : il ne doit plus pouvoir ouvrir une démo UGC réel.
update public.factory_bricks set meta = jsonb_set(meta, '{compatible_subjects}', '["static-ads"]'::jsonb), updated_at = now()
where id = 'H77';
