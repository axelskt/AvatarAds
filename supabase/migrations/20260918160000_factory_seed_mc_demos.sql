-- Creative Factory — seed 18/09 : unités/hooks Motion Control, complétion OMNI (10 hooks),
-- démos « visite guidée », musiques, sous-titres, avatars placeholder. Idempotent (ON CONFLICT).

insert into public.factory_bricks (id, kind, subject, label, meta) values
  ('TX-M01','transformation','motion-control','Homme → Femme (cuisine)',
   '{"before":{"label":"original homme","file":"MC/VIdéo 1.mp4","native":"16:9"},"after":{"label":"personnage femme","file":"MC/Vidéo 1.1.mp4"},"ratio":"9:16","note":"source paysage recadrée 9:16"}'::jsonb),
  ('TX-M02','transformation','motion-control','Homme → Femme (Spider-Man)',
   '{"before":{"label":"original homme","file":"MC/Vidéo 2.mp4"},"after":{"label":"personnage femme","file":"MC/Vidéo 2.1.mp4"},"ratio":"9:16"}'::jsonb),
  ('TX-M04','transformation','motion-control','Homme → Femme (veste)',
   '{"before":{"label":"original homme","file":"MC/Vidéo 4.mp4"},"after":{"label":"personnage femme","file":"MC/Vidéo 4.1.mp4"},"ratio":"9:16"}'::jsonb)
on conflict (id) do update set label=excluded.label, meta=excluded.meta, updated_at=now();

insert into public.factory_recipes (id, kind, subject, components, status) values
  ('HK-M01-02','hook','motion-control','[{"slot":"A","brick_id":"TX-M01"},{"slot":"B","brick_id":"TX-M02"}]'::jsonb,'done'),
  ('HK-M02-01','hook','motion-control','[{"slot":"A","brick_id":"TX-M02"},{"slot":"B","brick_id":"TX-M01"}]'::jsonb,'done'),
  ('HK-M01-04','hook','motion-control','[{"slot":"A","brick_id":"TX-M01"},{"slot":"B","brick_id":"TX-M04"}]'::jsonb,'done'),
  ('HK-M04-01','hook','motion-control','[{"slot":"A","brick_id":"TX-M04"},{"slot":"B","brick_id":"TX-M01"}]'::jsonb,'done'),
  ('HK-M02-04','hook','motion-control','[{"slot":"A","brick_id":"TX-M02"},{"slot":"B","brick_id":"TX-M04"}]'::jsonb,'done'),
  ('HK-M04-02','hook','motion-control','[{"slot":"A","brick_id":"TX-M04"},{"slot":"B","brick_id":"TX-M02"}]'::jsonb,'done'),
  ('HK-O02b-01','hook','omni','[{"slot":"A","brick_id":"TX-O02b"},{"slot":"B","brick_id":"TX-O01"}]'::jsonb,'done'),
  ('HK-O03-02b','hook','omni','[{"slot":"A","brick_id":"TX-O03"},{"slot":"B","brick_id":"TX-O02b"}]'::jsonb,'done')
on conflict (id) do update set components=excluded.components, status=excluded.status, updated_at=now();

insert into public.factory_bricks (id, kind, subject, label, meta, status) values
  ('C-OMNI-01','contenu','omni','Visite guidée OMNI 1','{"file":"W CRÉA/visite guidée/OMNI/visite guidée 1 omni.mp4"}'::jsonb,'ready'),
  ('C-OMNI-02','contenu','omni','Visite guidée OMNI 2','{"file":"W CRÉA/visite guidée/OMNI/visite guidée omni 2.mp4"}'::jsonb,'ready'),
  ('C-OMNI-03','contenu','omni','Visite guidée OMNI 3','{"file":"W CRÉA/visite guidée/OMNI/visite guidé omni 3.mp4"}'::jsonb,'ready'),
  ('C-OMNI-04','contenu','omni','Visite guidée OMNI 4','{"file":"W CRÉA/visite guidée/OMNI/visite guidée 4 omni.mp4"}'::jsonb,'ready'),
  ('C-IMGIA-01','contenu','image-ia','Démo Image IA 1','{"file":"W CRÉA/visite guidée/Image IA/Démo Image IA 1 .mp4"}'::jsonb,'ready'),
  ('C-IMGIA-02','contenu','image-ia','Démo Image IA 2','{"file":"W CRÉA/visite guidée/Image IA/Démo Image IA 2.mp4"}'::jsonb,'ready'),
  ('C-IMGIA-03','contenu','image-ia','Démo Image IA 3','{"file":"W CRÉA/visite guidée/Image IA/Démo Image IA 3.mp4"}'::jsonb,'ready'),
  ('C-IMGIA-04','contenu','image-ia','Démo Image IA 4','{"file":"W CRÉA/visite guidée/Image IA/Démo Image IA 4.mp4"}'::jsonb,'ready'),
  ('C-IMGIA-05','contenu','image-ia','Démo Image IA 5','{"file":"W CRÉA/visite guidée/Image IA/IMG_6190.MOV"}'::jsonb,'ready'),
  ('C-CLAUDE-01','contenu','mcp-claude','Démo Connecter Claude','{"file":"W CRÉA/visite guidée/Claude/IMG_6008.mov"}'::jsonb,'ready')
on conflict (id) do update set label=excluded.label, meta=excluded.meta, status=excluded.status, updated_at=now();

insert into public.factory_bricks (id, kind, subject, label, meta) values
  ('M01','musique','general','Convergence','{"file":"Musique/Musique 2/Convergence.mp3","famille":"bed"}'::jsonb),
  ('M02','musique','general','Let it burn','{"file":"Musique/Musique 2/Let it burn.mp3","famille":"bed"}'::jsonb),
  ('M03','musique','general','Me And The Devil (Instr.)','{"file":"Musique/Musique 2/Me And The Devil (Instrumental).mp3","famille":"bed"}'::jsonb),
  ('M04','musique','general','Monuments','{"file":"Musique/Musique 2/Monuments.mp3","famille":"bed"}'::jsonb),
  ('M05','musique','general','She Will (Instr. Slowed)','{"file":"Musique/Musique 2/She Will Instrumental Slowed.mp3","famille":"bed"}'::jsonb),
  ('M06','musique','general','falling forwards','{"file":"Musique/Musique 2/falling forwards.mp3","famille":"bed"}'::jsonb),
  ('M07','musique','general','do i clench my fists','{"file":"Musique/Musique 2/ridgeclub - do i clench my fists.mp3","famille":"bed"}'::jsonb),
  ('M08','musique','general','FATIGUE (uh..)','{"file":"Musique/Musique 2/ta1ls - FATIGUE (uh..) 4.mp3","famille":"bed"}'::jsonb),
  ('M09','musique','motion-control','trending 1','{"famille":"ssstik","note":"copyright cross-plateforme à cadrer"}'::jsonb),
  ('M10','musique','motion-control','trending 2','{"famille":"ssstik"}'::jsonb),
  ('M11','musique','omni','trending 3','{"famille":"ssstik"}'::jsonb),
  ('M12','musique','omni','trending 4','{"famille":"ssstik"}'::jsonb),
  ('M13','musique','omni','trending 5','{"famille":"ssstik"}'::jsonb)
on conflict (id) do update set label=excluded.label, meta=excluded.meta, updated_at=now();

insert into public.factory_bricks (id, kind, subject, label, meta, status) values
  ('S01','sous-titre','general','word-style-v3 (Anton capitales)','{"cadence_s":2.1}'::jsonb,'ready'),
  ('S02','sous-titre','general','styles render-worker','{}'::jsonb,'ready'),
  ('A01','avatar','general','Avatar homme (à définir)','{"genre":"H"}'::jsonb,'flagged'),
  ('A02','avatar','general','Avatar femme (à définir)','{"genre":"F"}'::jsonb,'flagged')
on conflict (id) do update set label=excluded.label, meta=excluded.meta, status=excluded.status, updated_at=now();
