-- Axel 27/10 : le format « texte incrusté » s'appelle « Sous-titres en arrière-plan » (même id F-AP-INCRUSTE, stats gardées)
update public.factory_formats
   set nom = 'Sous-titres en arrière-plan',
       description = 'Les sous-titres passent derrière l''avatar détouré, le mot fort en couleur devant (à plat ou dégradé) ; deux résultats de l''app arrivent derrière lui, puis la démo et l''appel à l''action.'
 where id = 'F-AP-INCRUSTE';
