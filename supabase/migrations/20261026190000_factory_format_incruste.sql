-- Format « texte incrusté » (Axel 26/10) : sous-titres derrière l'avatar détouré, mot fort en vert devant, 2 Hook démo
-- derrière l'avatar, consigne du CTA devant. Recette : brick_combo.incruste = true.
insert into public.factory_formats (id, nom, famille, description, ordre, statut)
values ('F-AP-INCRUSTE', 'Avatar qui parle + texte incrusté', 'Avatar qui parle',
        'Les mots de l''accroche passent derrière l''avatar détouré, le mot fort en vert devant ; deux résultats de l''app arrivent derrière lui, puis la démo et l''appel à l''action.',
        15, 'test')
on conflict (id) do nothing;

create or replace function public.factory_format_de(c jsonb)
 returns text
 language sql
 stable
 set search_path to 'public'
as $function$
  select case
    when c is null then null
    when c ? 'fond_vert' then 'F-MC-FONDVERT'
    when c ? 'voix_off' then 'F-MC-VOIXOFF'
    when coalesce((c->>'incruste')::boolean, false) then 'F-AP-INCRUSTE'
    when c->>'split' = 'A' then 'F-AP-SPLIT-A'
    when c->>'split' = 'B' then 'F-AP-SPLIT-B'
    when coalesce(c->>'hook_variant', '') ilike '%GRILLE%' then 'F-AP-GRILLE'
    when c ? 'reaction' or c->>'format' = 'F05' then case
      when c->>'reaction' like 'R-I-%' then 'F-TM-INSOMNIE'
      when c->>'reaction' like 'R-LIT%' then 'F-TM-LIT'
      when c->>'reaction' like 'R-STADE%' then 'F-TM-STADE'
      when c->>'reaction' like 'S-%' then 'F-TM-SCOTCH'
      when exists (select 1 from public.factory_bricks b where b.id = c->>'reaction' and coalesce((b.meta->>'parlee')::boolean, false)) then 'F-TC-PARLEE'
      when c->>'reaction' like 'R-AX-%' then 'F-TM-AXEL'
      when coalesce(c->>'musique', '') = '' then 'F-TC-CHOQUE'
      else 'F-TM-CHOQUE' end
    when c->>'voice' = 'axel' then case
      when c ? 'assemblage' then 'F-VA-HK'
      when c ? 'transformation' then 'F-VA-TRANSFO'
      when coalesce(c->>'illustrations', '[]') <> '[]' then 'F-VA-ILLUS'
      else 'F-VA-SIMPLE' end
    when c->>'voice' = 'omni' then 'F-AP-CLASSIQUE'
  end
$function$;
