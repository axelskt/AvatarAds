-- ig_followup_candidates() est SECURITY DEFINER et n'a pas de garde owner : par défaut Postgres
-- l'accordait à PUBLIC, donc n'importe quel visiteur muni de la clé publique pouvait lister les
-- sender_id Instagram des leads en cours de relance (audit du 23/09/2026).
-- Seule l'edge function ig-followup (service_role) doit l'appeler.
revoke all on function public.ig_followup_candidates() from public, anon, authenticated;
grant execute on function public.ig_followup_candidates() to service_role;
