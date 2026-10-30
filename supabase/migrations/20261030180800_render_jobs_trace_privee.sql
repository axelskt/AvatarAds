-- 30/10 (audit Décupleur, faille 8) : la colonne render_jobs.trace (journal du moteur pour un rendu : lignes yt-dlp, ffmpeg,
-- taille du moteur…) n'est plus lisible par les comptes clients. Lue en base le 30/10 : « authenticated » avait SELECT sur
-- TOUTE la table (policy render_jobs_select_own : sa propre ligne) ; anon rien. Ni l'app (aucun from('render_jobs') dans
-- app/index.html : le suivi passe par la fonction render-job, clé service) ni aucune page ne lit la table avec un jeton client.
-- Le moteur, render-job, le MCP et les autres fonctions passent par service_role : inchangés.
-- Méthode : SELECT de table retiré, puis SELECT colonne par colonne sur toutes les colonnes SAUF trace (une révocation de
-- colonne seule ne retire rien tant que le droit de table existe). Conséquences : un select('*') avec un jeton client sur
-- render_jobs serait refusé (aucun aujourd'hui) ; une colonne AJOUTÉE plus tard n'est lisible par les clients que si elle
-- est accordée explicitement (grant select (col) … to authenticated).
-- Le contenu de trace / error des jobs Décupleur est en plus assaini par le moteur (render-worker/decupleur.mjs).
revoke select on table public.render_jobs from anon, authenticated;
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'render_jobs' and column_name <> 'trace';
  execute format('grant select (%s) on table public.render_jobs to authenticated', v_cols);
end $$;
