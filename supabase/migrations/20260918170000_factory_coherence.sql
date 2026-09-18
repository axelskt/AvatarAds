-- Creative Factory — moteur de cohérence (v1, règles écrites) + sous-titres réels + group vidéo.

-- sous-titres réels (capStyle render-worker : word/caption/karaoke/neon/tiktok + hormozi)
insert into public.factory_bricks (id, kind, subject, label, meta) values
  ('S01','sous-titre','general','Word (mot-à-mot, Anton capitales)','{"value":"word"}'::jsonb),
  ('S02','sous-titre','general','Caption','{"value":"caption"}'::jsonb),
  ('S03','sous-titre','general','Karaoké','{"value":"karaoke"}'::jsonb),
  ('S04','sous-titre','general','Néon','{"value":"neon"}'::jsonb),
  ('S05','sous-titre','general','TikTok','{"value":"tiktok"}'::jsonb),
  ('S06','sous-titre','general','Hormozi','{"value":"hormozi"}'::jsonb)
on conflict (id) do update set label=excluded.label, meta=excluded.meta, updated_at=now();

-- group vidéo (deux unités du MÊME group = même original → s'excluent dans un hook)
update public.factory_bricks set meta = meta || '{"group":"O1"}'::jsonb where id='TX-O01';
update public.factory_bricks set meta = meta || '{"group":"O2"}'::jsonb where id in ('TX-O02a','TX-O02b');
update public.factory_bricks set meta = meta || '{"group":"O3"}'::jsonb where id='TX-O03';
update public.factory_bricks set meta = meta || '{"group":"M1"}'::jsonb where id='TX-M01';
update public.factory_bricks set meta = meta || '{"group":"M2"}'::jsonb where id='TX-M02';
update public.factory_bricks set meta = meta || '{"group":"M4"}'::jsonb where id='TX-M04';

-- Matrice des hooks VALIDES : paire ordonnée d'unités de MÊME sujet, GROUPS distincts.
-- Left-join recettes → done / pending. C'est la surface « en attente » du tableau des IDs.
create or replace function public.factory_hook_matrix()
returns table(subject text, slot_a text, slot_b text, recipe_id text, status text)
language sql stable as $$
  with tx as (
    select id, subject, coalesce(meta->>'group', id) as grp
    from public.factory_bricks where kind = 'transformation'
  )
  select a.subject, a.id, b.id, r.id, coalesce(r.status,'pending')
  from tx a
  join tx b on b.subject = a.subject and b.grp <> a.grp
  left join public.factory_recipes r
    on r.kind = 'hook' and r.subject = a.subject
   and r.components = jsonb_build_array(
         jsonb_build_object('slot','A','brick_id',a.id),
         jsonb_build_object('slot','B','brick_id',b.id))
$$;

-- render_url des hooks = fichier local nommé par ID (miroir « rendus hooks/ » dans Téléchargements)
update public.factory_recipes set render_url = 'rendus hooks/' || id || '.mp4', updated_at = now()
where kind = 'hook' and render_url is null;
