// reconcile-kie — filet « jamais perdre une génération kie » (23/09/2026) + facturation des tâches clients (25/09/2026).
// Toute la logique vit dans ./handler.ts — séparée du serve() pour être testée (fetch / RPC simulés). Voir son en-tête.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handler } from './handler.ts'

serve(handler)
