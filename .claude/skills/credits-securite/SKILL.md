---
name: credits-securite
description: Les crédits AvatarAds et leur verrouillage serveur — barème, RPC SECURITY DEFINER, débit avant appel fournisseur, remboursement, gating du plan Free, quotas. À lire AVANT d'ajouter une action payante, de toucher au solde d'un utilisateur, à la table profiles, ou à un flux de paiement. La règle centrale : le client ne décide jamais d'un crédit.
---

# Crédits & sécurité

Un crédit est de l'argent. Tout ce qui en dépense passe par le serveur.

## La règle unique

**Aucun `update` direct sur `profiles` pour `plan`, `credits_remaining`,
`credits_total` ou les quotas.** Ces colonnes sont fermées à l'utilisateur ; seules
des fonctions `SECURITY DEFINER` y touchent. Un client qui pourrait s'auto-créditer
rendrait tout le reste inutile.

| RPC | Rôle |
|---|---|
| `spend_credits(p_secs, p_reason)` | débite et journalise — le seul chemin de débit côté app |
| `refund_credits(...)` | rembourse un débit déjà passé |
| `mcp_spend_credits` / `mcp_refund_credits` | mêmes règles pour le serveur MCP (service role) |
| `mcp_spend_for_job(p_user, p_job, p_cost)` | MCP : débite ET pose `credits_cost` du job dans la même transaction (job créé à 0 avant le débit) — les filets ne rendent que ce qui a été pris |
| `use_video_quota` / `ensure_quota_month` | quotas mensuels par plan |
| `charge_voice_clone` | clonage de voix ElevenLabs |
| `claim_retention_bonus`, `get_referral_count` | bonus et parrainage |

⚠️ **Piège de déploiement :** un `GRANT EXECUTE ... TO PUBLIC` sur une de ces
fonctions annule la protection. Vérifier les droits après chaque migration.

## Le flux d'une action payante

```
spendCreditsFor(montant, 'libellé')       ← app/index.html, point d'entrée UNIQUE
  ↓ (échoue → on s'arrête, rien n'est appelé)
appel fournisseur (OpenAI / Google / Hedra / fal / ElevenLabs)
  ↓ échec
creditsFlowRefund('raison')               ← remboursement vérifiable dans credit_ops
```

**On débite AVANT l'appel fournisseur, jamais après.** Débiter après laisserait
passer les générations gratuites en cas de crash ; débiter avant rend le
remboursement explicite et traçable (`credit_ops`).

`spendCreditsFor` fait aussi, dans l'ordre :
1. pas de membre → paywall ;
2. `_spendLock` → une seule génération à la fois ;
3. plan `developer` ou `is_owner` → illimité, aucun débit ;
4. **plan Free → `showPlansSheet()`**, c'est le gating « à l'action » : le free
   compose tout ce qu'il veut, le mur tombe au moment d'appeler une API payante ;
5. solde insuffisant → message chiffré + proposition d'upgrade ;
6. `sb.rpc('spend_credits', …)`.

Toute nouvelle action payante passe par là. Pas de chemin parallèle.

Côté proxys, un job asynchrone est **lié** à son op (`bind_reservation_job`, la
première liaison gagne : une op = un job). Sa libération (`release_by_job`), son
règlement (`settle_by_job`) et son remboursement (`refund_by_job_terminal`) ont
lieu **exactement une fois** (`credit_ops.job_bill_state`, migration
20260925233000) : relire le suivi d'un job échoué ne rend plus rien de plus.
Ne jamais « rendre » un job en ré-ajoutant `job_drawn` hors de ces RPC.

## Le barème (`CREDIT_COSTS` dans `app/index.html`)

| Action | Coût |
|---|---|
| Image standard / premium / 4K | 1 / 3 / 5 |
| « Améliorer en 4K », upscale 4K | 5 |
| Montage IA (plan) / re-rendu d'un plan modifié | 8 / 4 |
| Lipsync Hedra (Avatar / Character-3, 1080p) — app, worker, MCP | 2 cr/s |
| Lipsync OmniHuman 1.5 (kie pour les clients Élite, fal en repli) | 5 cr/s |
| Voix ElevenLabs (en plus du lipsync) | 0,5 cr/s |
| Express Veo 3.1 Lite / Fast (kie pour les clients, repli Google ; 1080p ×2) | 1,5 / 3 cr/s |
| Nettoyage audio, débruitage, transcription | 1 |
| Export Éditeur, réutilisation d'avatar | 2 |

Le barème est lu depuis la constante partout (boutons compris) : le changer à un
seul endroit suffit, et l'UI suit.

OmniHuman (26/09, relu le 26/09) : la durée facturée n'est JAMAIS celle du client. kie-proxy et fal-proxy lisent le WAV
reçu (`_shared/lipsync-audio.ts` : UN seul chunk « fmt », sinon refus), en fabriquent une COPIE CANONIQUE (un seul fmt,
un seul data = tous les octets présents) déposée dans `render-media/omnih-in/` : c'est elle que le fournisseur lit, il
décode exactement ce qui est facturé. Tirage EXACT ⌈5 × max(1 s, durée − marge)⌉, marge = min(0,6 s, max(silence
numérique final, 10 % de la durée)) : le silence ajouté après le dernier mot est gratuit, la suite réelle de la voix ne
l'est qu'à 10 % (plus de remise par découpage en tranches). fal-proxy : OmniHuman gaté comme `KIE_OPEN` (Élite) et UN
seul job fal par op (402 sinon). Même formule côté app (`_omnihCout`, `_omnihCoutWav`) : à changer ENSEMBLE.

Montage IA (app, 26/09) : UNE op par scène (montant = ce que le proxy tirera ; Hedra : de quoi couvrir la
réconciliation sans jamais charger notre marge au client), une op « habillage », et `render-job` reçoit
`ops: [op du montage, op de l'habillage]` (revérifiées serveur, tirées entières). Aucune op d'un montage livré ne garde
de réserve remboursable. MCP `lipsync_video` : durée MESURÉE (WAV canonique / trames MP3 comptées), autre format refusé.

## Les clés d'API ne sont jamais dans le client

Chaque fournisseur a son edge function proxy : `openai-proxy`, `google-ai-proxy`,
`hedra-proxy`, `fal-proxy`, `elevenlabs-proxy`. Le client appelle le proxy avec sa
session ; le proxy tient la clé. Ajouter un fournisseur = ajouter un proxy, jamais
une clé dans `app/index.html`.

## Tester sans dépenser

- Compte `developer` / `is_owner` → illimité, aucun débit.
- Compte de test Starter : `ax.quiivix@gmail.com`.
- Pour tester un OTP, **jamais un alias Gmail d'Axel** : adresse jetable, et le
  code se lit dans Resend.
