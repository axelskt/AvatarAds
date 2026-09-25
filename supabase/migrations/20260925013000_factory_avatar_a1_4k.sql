-- Creative Factory (25/09/2026, Axel) : A1-1 à A1-4 étaient des versions non 4K (1152×2048) → remplacées par les 4K (.jpg).
update public.factory_bricks
set meta = jsonb_set(meta, '{images}', (
      select jsonb_agg(regexp_replace(x, '/A1-([1-4])\.png$', '/A1-\1.jpg') order by n)
      from jsonb_array_elements_text(meta->'images') with ordinality as t(x, n))),
    updated_at = now()
where id = 'A1';
