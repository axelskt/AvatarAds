// Supabase Edge Function — kie.ai proxy (23/09/2026 ; ouvert aux clients payants le 25/09/2026).
// Toute la logique (accès, réservation, suivi, rapatriement) vit dans ./handler.ts — séparée du serve() pour être testée
// (tests Deno avec fetch / RPC simulés, aucun appel kie réel). Voir l'en-tête de handler.ts.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handler } from './handler.ts'

serve(handler)
