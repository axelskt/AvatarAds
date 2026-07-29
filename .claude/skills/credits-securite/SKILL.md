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

## Le barème (`CREDIT_COSTS` dans `app/index.html`)

| Action | Coût |
|---|---|
| Image standard / premium / 4K | 1 / 3 / 5 |
| « Améliorer en 4K », upscale 4K | 5 |
| Montage IA (plan) / re-rendu d'un plan modifié | 8 / 4 |
| Lipsync Hedra Character-3 | 1 cr/s |
| Lipsync OmniHuman 1.5 (fal) | 5 cr/s |
| Voix ElevenLabs (en plus du lipsync) | 0,5 cr/s |
| Express Veo 3.1 Lite / Fast | 1 / 3 cr/s |
| Nettoyage audio, débruitage, transcription | 1 |
| Export Éditeur, réutilisation d'avatar | 2 |

Le barème est lu depuis la constante partout (boutons compris) : le changer à un
seul endroit suffit, et l'UI suit.

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
