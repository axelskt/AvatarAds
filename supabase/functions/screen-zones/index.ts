import { authUser } from '../_shared/guard.ts'
// ─────────────────────────────────────────────────────────────────────────────
// #159 · LIRE UNE CAPTURE D'ÉCRAN : où la rogner, et que contient-elle.
//
// Jusqu'ici les captures d'AvatarAds vivaient en dur dans le dépôt, avec les
// coordonnées de chaque bouton MESURÉES À LA MAIN (render-worker/screen-spots.mjs).
// Ça ne marche que pour un seul compte : celui d'AvatarAds. Axel : « il ne faut
// pas que les captures soient celles d'AvatarAds en dur, il faut que ce soit
// celles de l'user ».
//
// Cette fonction remplace la mesure manuelle. On lui donne une capture, elle
// renvoie :
//   · crop  — la zone utile, hors chrome du système (barre de menus macOS,
//             barre d'outils du navigateur, dock, ombres du bureau). Axel :
//             « y'a des photos que j'ai oublié de rogner, fais-le pour pas voir
//             la barre du haut ».
//   · zones — les éléments cliquables NOMMÉS, en coordonnées normalisées sur
//             l'image DÉJÀ ROGNÉE : c'est ce que le chef d'orchestre désignera
//             (« mot | écran | zone ») et ce que le moteur encadrera au zoom.
//
// L'utilisateur peut tout corriger ensuite dans l'Éditeur : la détection est un
// point de départ, pas une vérité.
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const MODEL = 'claude-opus-4-8'
const MAX_BYTES = 8 * 1024 * 1024

// Le schéma est VOLONTAIREMENT plat (lignes « nom|label|x|y|w|h »). Une grammaire
// à tableaux d'objets avait déjà mis le Montage IA à l'arrêt en mode strict :
// « grammar is too large ». Le serveur reparse, c'est trivial et ça ne casse pas.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['crop', 'app', 'zones'],
  properties: {
    crop: { type: 'string' },   // "x|y|w|h" en 0→1 sur l'image d'ORIGINE
    app: { type: 'string' },    // « AvatarAds », « Claude », « Shopify »…
    zones: { type: 'array', items: { type: 'string' } }, // "nom|label|x|y|w|h"
  },
}

const SYSTEM = `Tu lis une capture d'ecran d'application ou de site web, et tu la prepares pour une video de tutoriel.

DEUX TRAVAUX.

1 · LE RECADRAGE (champ "crop", "x|y|w|h" en fractions de 0 a 1 sur l'image telle qu'elle t'est donnee).
Garde UNIQUEMENT le contenu de l'application. Enleve tout ce qui appartient au systeme ou au navigateur :
la barre de menus macOS ou Windows en haut, la barre d'onglets et la barre d'adresse du navigateur, la barre
de favoris, le dock, la barre des taches, les bords du bureau, une eventuelle infobulle de capture d'ecran.
Si la capture ne contient DEJA que l'application, renvoie "0|0|1|1".
Sois franc sur les bords : mieux vaut rogner 1 % de trop que laisser une barre grise.

2 · LES ZONES CLIQUABLES (champ "zones", une ligne par element).
Format EXACT, six champs separes par | :
  nom|label|x|y|w|h
  · nom   : identifiant court en minuscules, sans accent ni espace, tirets autorises. Il doit decrire
            la FONCTION, pas l'apparence : "menu-images-ia", "bouton-generer", "champ-prompt",
            "onglet-connecteurs", "bouton-ajouter". C'est ce nom qu'une IA choisira en entendant l'audio.
  · label : le texte exact lu a l'ecran ("Images IA", "Generer ma cle", "Ajouter un connecteur personnalise").
            Vide si l'element n'a pas de texte.
  · x y   : le CENTRE de l'element, en fractions de 0 a 1, mesurees sur l'image TELLE QU'ELLE T'EST DONNEE,
            AVANT ton recadrage. Ne fais aucune conversion mentale : le serveur s'en charge. (Demander des
            coordonnees dans le repere recadre produisait une derive verticale systematique sur tout le bas
            de l'image.)
  · w h   : sa largeur et sa hauteur, memes unites, sur l'image d'origine elle aussi.

CE QUE TU RETIENS : les elements sur lesquels on CLIQUE ou dans lesquels on ECRIT — entrees de menu,
boutons, onglets, champs de saisie, cases a cocher, interrupteurs, cartes selectionnables.
CE QUE TU IGNORES : les textes decoratifs, les paragraphes, les images d'illustration, les logos,
les zones vides. Ne remplis pas la liste pour la remplir : 5 a 20 zones VRAIES valent mieux que 40 approximatives.

PRECISION. Le cadre servira a ZOOMER sur l'element pendant que quelqu'un le nomme a l'oral : s'il est trop
large on ne voit pas de quoi il parle, s'il est decale on montre le mauvais bouton. Prends le rectangle
visible de l'element (son fond, son bord), pas seulement son texte.

Champ "app" : le nom du produit affiche dans la capture, tel qu'il s'ecrit.`

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST uniquement' }, 405)

  // Audit offensif 05/09 : atteignable avec la seule clé anon publique → Claude Opus vision facturé.
  const _a = await authUser(req)
  if (!_a.isService && !_a.userId) return json({ error: 'unauthorized' }, 401)

  try {
    const key = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
    if (!key) return json({ error: 'ANTHROPIC_API_KEY manquante' }, 500)

    const form = await req.formData()
    const file = form.get('image')
    if (!(file instanceof File)) return json({ error: 'Champ "image" manquant' }, 400)
    if (file.size > MAX_BYTES) return json({ error: 'Image trop lourde (max 8 Mo)' }, 400)

    const media = file.type === 'image/jpeg' ? 'image/jpeg'
      : file.type === 'image/webp' ? 'image/webp' : 'image/png'
    const bytes = new Uint8Array(await file.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    const b64 = btoa(bin)

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: b64 } },
            { type: 'text', text: 'Recadre cette capture et liste ses zones cliquables.' },
          ],
        }],
      }),
    })
    if (!res.ok) return json({ error: `Claude ${res.status}: ${(await res.text()).slice(0, 300)}` }, 502)

    const data = await res.json()
    const block = (data.content || []).find((b: { type: string }) => b.type === 'text')
    if (!block) return json({ error: 'Reponse vide' }, 502)
    const raw = JSON.parse(block.text)

    // ── normalisation : le modèle propose, le serveur borne ──
    const f = (v: string) => {
      const n = Number(String(v).replace(',', '.'))
      return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
    }
    const [cx, cy, cw, ch] = String(raw.crop || '0|0|1|1').split('|').map(f)
    // un recadrage qui garde moins de 30 % de l'image est forcément une erreur
    const crop = (cw >= 0.3 && ch >= 0.3 && cx + cw <= 1.001 && cy + ch <= 1.001)
      ? { x: cx, y: cy, w: cw, h: ch } : { x: 0, y: 0, w: 1, h: 1 }

    const seen = new Set<string>()
    const zones = (Array.isArray(raw.zones) ? raw.zones : []).map((line: string) => {
      const p = String(line).split('|')
      if (p.length < 6) return null
      const name = p[0].trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
      // repère IMAGE D'ORIGINE → repère IMAGE ROGNÉE. C'est le serveur qui fait
      // la conversion : la demander au modèle faisait dériver tout le bas.
      const x = (f(p[2]) - crop.x) / crop.w, y = (f(p[3]) - crop.y) / crop.h
      const w = f(p[4]) / crop.w, h = f(p[5]) / crop.h
      // hors cadre après recadrage, ou trop grosse pour désigner quoi que ce soit
      if (!name || seen.has(name)) return null
      if (x <= 0 || x >= 1 || y <= 0 || y >= 1) return null
      if (w <= 0.004 || h <= 0.004 || w > 0.55 || h > 0.55) return null
      seen.add(name)
      const r3 = (n: number) => Math.round(n * 1000) / 1000
      return { name, label: p[1].trim().slice(0, 60), x: r3(x), y: r3(y), w: r3(w), h: r3(h) }
    }).filter(Boolean).slice(0, 24)

    return json({ ok: true, app: String(raw.app || '').slice(0, 40), crop, zones, usage: data.usage })
  } catch (e) {
    return json({ error: String((e as Error).message || e).slice(0, 300) }, 500)
  }
})
