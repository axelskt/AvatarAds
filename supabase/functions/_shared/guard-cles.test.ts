// Reconnaissance de la clé de service (23/10, fuite Railway) : la clé injectée, TOUTES les clés secrètes du projet
// (SUPABASE_SECRET_KEYS), l'ancien JWT par son rôle — et rien d'autre.
// deno test --allow-env --allow-net supabase/functions/_shared/guard-cles.test.ts
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

const INJECTEE = 'sb_secret_injectee_0000000000000000'
const RAILWAY = 'sb_secret_railway_11111111111111111'
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', INJECTEE)
Deno.env.set('SUPABASE_SECRET_KEYS', JSON.stringify({ default: INJECTEE, railway: RAILWAY }))
const { estCleService, clesSecretes } = await import('./guard.ts')

const jwt = (role: string) => 'x.' + btoa(JSON.stringify({ role })).replace(/=+$/, '') + '.y'

Deno.test('clé injectée et clé « railway » reconnues, sans doublon', () => {
  assert(estCleService(INJECTEE))
  assert(estCleService(RAILWAY))
  assertEquals(clesSecretes().length, 2)
})

Deno.test('clé inconnue, clé publique, vide : refusées', () => {
  assert(!estCleService('sb_secret_inconnue_2222222222222222'))
  assert(!estCleService('sb_publishable_xxxxxxxxxxxxxxxx'))
  assert(!estCleService(''))
  assert(!estCleService(RAILWAY + 'x'))
})

Deno.test('ancien JWT : reconnu par son rôle service_role seulement', () => {
  assert(estCleService(jwt('service_role')))
  assert(!estCleService(jwt('anon')))
})

Deno.test('clé révoquée : refusée dès l’appel suivant ; variable illisible → seule la clé injectée', () => {
  Deno.env.set('SUPABASE_SECRET_KEYS', JSON.stringify({ default: INJECTEE }))
  assert(!estCleService(RAILWAY))
  Deno.env.set('SUPABASE_SECRET_KEYS', '{pas du json')
  assert(estCleService(INJECTEE))
  assert(!estCleService(RAILWAY))
})
