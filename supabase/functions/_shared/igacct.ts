// Comptes Instagram reliés (Axel 28/09 : un compte par avatar, A1 = @avataradss, A2 = @leoadsia ; 06/10 : @ialebd.axel = A1 + A2).
//
// Deux identifiants par compte, à ne jamais confondre :
//  - ig_user_id = id PROFESSIONNEL : celui des webhooks (entry.id) et de ig_dm_log.ig_id ;
//  - ig_id      = id app-scoped rendu par l'échange OAuth : clé de ig_accounts et des caches d'insights.
// Jusqu'au 28/09 l'auto-DM cherchait entry.id dans ig_id, ne trouvait rien et retombait sur le secret IG_TOKEN :
// un 2e compte aurait répondu avec le token du 1er. Le repli IG_TOKEN est désormais réservé au compte principal.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const PRIMARY_IG_USER_ID = Deno.env.get('IG_PRIMARY_USER_ID') || '17841465864328479'   // @avataradss
// Nos comptes (ceux du dashboard et de « Les deux »). Un compte relié par quelqu'un d'autre (reviewer Meta, futurs
// users TrackAds) n'entre jamais dans nos chiffres.
export const OWN_USERNAMES = (Deno.env.get('IG_OWN_USERNAMES') || 'avataradss,leoadsia,ialebd.axel')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

export type IgAccount = { ig_id: string, ig_user_id: string | null, username: string | null, access_token: string | null }

// Un compte par l'un OU l'autre de ses ids. Les ids Instagram sont numériques : tout le reste est retiré avant de
// construire le filtre (pas d'injection dans la syntaxe .or() de PostgREST).
export async function igAccount(svc: SupabaseClient, anyId: string): Promise<IgAccount | null> {
  const id = String(anyId || '').replace(/\D/g, '')
  if (!id) return null
  const { data } = await svc.from('ig_accounts').select('ig_id, ig_user_id, username, access_token')
    .or(`ig_user_id.eq.${id},ig_id.eq.${id}`).order('updated_at', { ascending: false }).limit(1)
  return (data?.[0] as IgAccount) || null
}

export async function accountToken(svc: SupabaseClient, anyId: string): Promise<string | null> {
  const a = await igAccount(svc, anyId)
  if (a?.access_token) return a.access_token
  return String(anyId || '') === PRIMARY_IG_USER_ID ? (Deno.env.get('IG_TOKEN') || null) : null
}

export async function ownAccounts(svc: SupabaseClient): Promise<IgAccount[]> {
  const { data } = await svc.from('ig_accounts').select('ig_id, ig_user_id, username, access_token').order('updated_at', { ascending: false })
  const seen = new Set<string>()
  return ((data || []) as IgAccount[]).filter((a) => {
    const u = String(a.username || '').toLowerCase()
    if (!OWN_USERNAMES.includes(u) || seen.has(u) || !a.access_token) return false
    seen.add(u)
    return true
  }).sort((a, b) => OWN_USERNAMES.indexOf(String(a.username).toLowerCase()) - OWN_USERNAMES.indexOf(String(b.username).toLowerCase()))
}
