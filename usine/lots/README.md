# Outils de lot — Creative Factory

Reconstruits le 14/10 après la perte du scratchpad : **ils vivent ici, jamais seulement dans un dossier temporaire.**
Dossier de travail (cache, états, rendus en cours) : `~/Downloads/Creative Factory/cache/lots/` (variable `CF_LOT_DIR`).

## Stock commun (16/10)

Une vidéo validée part sur **un seul compte, jamais deux** : un des 3 comptes Instagram d'Axel (le kit, servi en premier,
7 jours d'avance) **ou** un diffuseur BloxAI (une mission). Le stock commun = les missions « open » de BloxAI ; les fichiers
sont dans `factory-media/stock/<nom>.mp4` + `<nom>-poster.jpg` (poster = **image 0** de la vidéo). Le kit ne reçoit plus
rien directement : la fonction edge **`kit-recharge`** (AvatarAds, cron quotidien + `select kit_recharge_now()`) remplit
chaque compte depuis le stock jusqu'à J+7, **seulement après son dernier post** — un trou laissé avant le dernier post n'est
jamais comblé (d'où la règle « pas de trou » de `stock.py`).

| Commande | Rôle |
|---|---|
| `python3 usine/lots/lot.py 5 5 lot-1410b` | lance 5 séries × 5 vidéos (moitié parlées, moitié Texte + musique) → file de revue, statut *pending* |
| `DRY=1 python3 usine/lots/lot.py 5 5 essai` | essai à blanc : affiche le plan, ne rend rien |
| `python3 usine/lots/valider.py VF-0439 VF-0440` (ou `--lot lot-1410b`) | « validé » → **stock commun** : qc/ → stock/ (copie relue + poster image 0), fiche *approved*, mission ouverte dans BloxAI, puis `kit_recharge_now()` (le kit d'Axel se sert en premier). BloxAI pas prêt : validées dans stock/, à pousser plus tard avec `stock.py --pousser`. **Avant l'étape 4 du plan** (`kit_recharge_now()` absente) : ancien chemin du 14/10 (final/ + posts du kit + `equilibrer.py`) |
| `python3 usine/lots/stock.py --etat` | état : stock commun (missions par statut, réserve du kit), kit par compte (à programmer, au-delà de J+7, parqués), **trous avant le dernier post**, vidéos dans stock/ sans mission |
| `python3 usine/lots/stock.py --migrer [--jours 7]` | SIMULATION : les posts du kit au-delà de J+7 qui partiraient au stock, ceux qui restent (et pourquoi), poids à copier |
| `python3 usine/lots/stock.py --migrer --go [--paquet 10]` | exécute : du plus tard au plus tôt, final/ → stock/ (relu + poster image 0) → post du kit *skipped* « stock commun » + fiches → stock/ (1 transaction) → mission BloxAI → final/ supprimé. Reprenable : relancer jusqu'à « échecs 0 · restés dans le kit 0 » |
| `python3 usine/lots/stock.py --migrer [--go] --garder VF-0531 VF-0532 …` | (16/10) ces VF **restent sur leur compte d'Axel**, jamais au stock commun (ex. le lot gagnant VF-0531…VF-0541 de @leoadsia étalé par `etaler.py`) ; règle « pas de trou » : tous les posts plus tôt du même compte restent aussi. La simulation affiche les VF gardées, les posts retenus **à cause d'elles**, et où sont les autres (kit des 7 jours, déjà au stock, inconnue). En zsh / bash : `--garder VF-05{31..41}` |
| `python3 usine/lots/stock.py --pousser VF-… [--dry]` | met des vidéos validées dans le stock commun (hors kit des 7 jours, jamais une vidéo déjà programmée / publiée, jamais un post au milieu du kit) |
| `python3 usine/lots/refaire.py VF-0316 …` | refait EN PLACE des vidéos déjà dans le kit, Texte + musique ou parlées (même recette, variante ACTUELLE du hook / CTA, règles du jour) ; une vidéo venue du stock reste dans stock/ |
| `python3 usine/lots/verifier.py` | contrôle du kit : vidéo accessible, adresse valide, aucun post parqué en 2099, aucune vidéo du kit aussi proposée aux diffuseurs |
| `python3 usine/lots/equilibrer.py [AAAA-MM-JJ] [--dry]` | **plus lancé** (ni par `valider.py` une fois le stock commun en place, ni à la main) : il réattribuerait les posts J+4…J+7 que `kit-recharge` vient de poser, et `kit-recharge` alterne déjà parlé / sans voix |

**Pas de trou dans le kit** : `stock.py` fait sortir les posts du plus tard au plus tôt, et un post ne sort que s'il est plus
tard que tout ce qui reste sur son compte. Un post qui reste (fichier absent, copie ratée, déjà programmé, cas « à vérifier »)
garde dans le kit tous les posts plus tôt du même compte ; `--etat` signale tout créneau vide avant le dernier post.

**`--garder` (16/10)** : une VF listée qui est un post du kit au-delà de J+7 reste « à programmer » sur son compte, comme un
post qui ne peut pas sortir — donc tout ce qui la précède sur ce compte reste aussi (la simulation dit combien de posts
restent **en plus** à cause d'elle). Une VF déjà dans le kit des 7 jours, déjà programmée ou publiée reste de toute façon ;
une VF déjà passée au stock commun n'est **pas** ramenée. `--go` est refusé si une VF de la liste n'a aucun post Instagram
(faute de frappe ?), et une VF écrite ailleurs que derrière `--garder` est refusée (elle partirait au stock sans qu'on le
voie). **La liste n'est pas mémorisée** : chaque relance (`--go` interrompu, reprise) doit reprendre le même `--garder` —
la commande de relance affichée à la fin l'inclut ; un `--migrer --go` lancé plus tard sans `--garder` ferait partir ces
posts s'ils sont encore au-delà de J+7.

Les règles de rendu (bruitages, centrage, cartes de résultats, musique) sont dans l'usine (`build.mjs`, `build-f05.mjs`,
`formats.js`, `illustrations.json`) ; les règles de recette (démos, réactions, anti-doublon) dans `plan.mjs` ; les règles de
programmation du kit (comptes, horaires 12-14-16-18-20 h (@avataradss), 12-16-20 h (@leoadsia, depuis le 16/10), 11-13-15-17-19 h (@ialebd.axel), J+7, alternance, même photo / réaction jamais de
suite, légendes = le CTA) dans la fonction **`supabase/functions/kit-recharge`** (plus dans `valider.py`) ; le stock commun
lui-même (missions, diffuseurs) dans le projet BloxAI (`bloxai-site/supabase`).
