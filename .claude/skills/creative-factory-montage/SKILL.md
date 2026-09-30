---
name: creative-factory-montage
description: Monter une VIDÉO FINALE Creative Factory (hook → liaison → démo → CTA) prête à poster, avec sous-titres, bruitages, transitions, musique de fond et hook soigné. À lire AVANT tout montage de vidéo finale (test ou série), pour ne rien rechercher : choix des briques, téléchargement, commande exacte, réglages validés, contrôle, enregistrement QC.
---

# Monter une vidéo finale (Creative Factory)

Une vidéo finale = **HOOK (+ LIAISON) → DÉMO → CTA**, 9:16 1080×1920, **60 i/s** (Axel 29/09 : les démos sont tournées en 60 i/s ;
1080×1920 = le maximum affiché par Reels / TikTok, la source 4K reste intacte). Tout se fait en local, **zéro crédit**
(lipsync déjà produits dans `factory_variants`, transcription Whisper locale, rendu HyperFrames local).

## 1. Choisir les briques (cohérence, jamais au hasard total)

| Brique | Où | Règle |
|---|---|---|
| Hook | `factory_bricks` kind `hook`, clips `factory_variants` (format `axel`) | `meta.compatible_subjects` contient le **sujet de la démo** |
| Liaison (format long) | `usine/hook-liaison.js` (`CF_HOOK_LIAISON[Hxx]`) | seulement une liaison **de la matrice** du hook ; même **photo** que le hook |
| Démo | `factory_bricks` kind `contenu`, status `ready` | sujet ∈ sujets du hook ; `retired` exclues |
| CTA | clips `factory_variants` `…-CTA-…` | **même photo** que le hook si possible, sinon même avatar |
| Musique | `~/Downloads/Creative Factory/musique/beds/` (pistes complètes) | plus longue que la vidéo ; les `music/Mxx.mp3` du bucket ne font que 15 s → ne pas les utiliser |

- Une photo = un compte : **A1-x → @avataradss**, **A2-x → @leoadsia**.
- Photos à éviter pour les mains : A1-1, A1-2, A1-7 ; jamais A1-4 ; A2-6 a déjà tordu les doigts (H24).
- Requête utile (hooks compatibles avec les démos dispo + photos qui ont le clip) :
  ```sql
  select b.id, b.meta->'compatible_subjects', left(b.label,70), string_agg(v.avatar_id,' ' order by v.avatar_id)
  from factory_bricks b join factory_variants v on v.brick_id=b.id and v.format='axel'
  where b.kind='hook' and b.status='ready' and (b.meta->'compatible_subjects')::text ~ '(omni|image-ia|static-ads)'
  group by 1,2,3 order by 1;
  ```
- Clips disponibles pour une photo : `select avatar_id, string_agg(brick_id,' ') from factory_variants where format='axel' and avatar_id='A2-9' group by 1;`

## 2. Préparer (dossier de travail dans le scratchpad)

```bash
# URLs exactes (ne jamais reconstruire un nom de fichier : certains ont -v2)
supabase db query --linked -o csv "select avatar_id||'|'||brick_id||'|'||video_url from factory_variants where format='axel' and avatar_id='A2-9' and brick_id in ('H77','L16','CTA-SITE-teste')"
curl -s -o A2-9-H77.mp4 "<video_url>"          # idem liaison, CTA, démo (meta->>'media' de la brique contenu)
# export des briques pour build.mjs (pas de clé service en local) + aucune recette déjà faite
supabase db query --linked -o json "select coalesce(json_agg(x),'[]'::json) as j from (select id,kind,subject,label,status,meta from factory_bricks) x"  # → bricks.json (extraire rows[0].j)
echo '[]' > done.json
```

**Format long : la liaison et le B-roll sont gérés par build.mjs** (`--liaison`, `--broll`, voir §3). Ne plus coller
hook + liaison à la main.

## 3. Monter (une commande)

```bash
cd "Autre SaaS/avatarads-membres"
export PRODUCER_BROWSER_GPU_MODE=hardware
node usine/build.mjs HOOK.mp4 DEMO.mp4 OUT.mp4 "MUSIQUE.mp3" HOOK.mp4 CTA.mp4 \
  --liaison LIAISON.mp4 --broll "BROLL1.mp4,BROLL2.png" \
  --hook-id H77 --demo C-SADS-01 --bricks bricks.json --done done.json
```
- 5e argument = **le clip du hook lui-même** comme voix (sinon le hook est muet).
- Caches (`~/Downloads/Creative Factory/cache/`) : démo convertie UNE fois en 1080×1920 60 i/s (`demos/`), mots Whisper
  d'une brique gardés par empreinte (`words/`) → au 2e montage avec les mêmes briques, plus de conversion ni de
  transcription. Encodage VideoToolbox (matériel du Mac) 20 Mb/s. Lancer en arrière-plan, une vidéo à la fois.
- Garde-fou : si la piste vidéo ne couvre pas le son (raccords décalés), build.mjs s'arrête (bug du 29/09 : hook plus
  court que voix + respiration → CTA jamais affiché, image figée).

- `--liaison` (format long) : hook + liaison collés en coupe franche, voix traitées séparément par la même chaîne.
- `--broll a.mp4,b.png` : quand la liaison dit « regarde ça » (ou voici / voilà, `--broll-after`), ce qu'elle annonce
  apparaît en **CARTE arrondie centrée** (460 px de large, au format du média, fine bordure blanche, pop à l'entrée)
  jusqu'à la fin de la liaison — **jamais plein écran**. 2 médias : la 1re carte se pousse à gauche quand la 2e arrive à
  droite, les deux restent côte à côte. Aucun fond blanc autour d'une image. Choisir selon le contexte : produit physique → vidéo produit (ex. fille avec la canette CIAO) et/ou
  static ad ; « image et vidéo » → les deux. B-roll dispo : `~/Downloads/Creative Factory/cache/broll/`.
- `--hook-broll "fichier|mots d'entrée|mots de sortie"` : illustration du HOOK (Axel 30/09). Quand le hook dit les mots
  d'entrée (« comme ça », « créer », « faire »), le média arrive par la DROITE en grand (720 px), à la place de l'avatar ;
  sa sortie vers la GAUCHE (0,3 s) DÉMARRE sur les mots de sortie (« je vais »), sinon à la liaison / transition.
  « Vidéos IA comme ça » → un avant / après Omni (assemblage `HK-O2-0a`) ; « avatar / influenceuse IA » → une fille 4K
  (`avatar-ia-fille-4k.jpg`, `avatar-ia-fille-4k-b.jpg`). **Le texte choc s'efface quand l'illustration arrive**
  (0,8 s mini) : il gênait la vidéo (VF-0003).
- **`--illus auto` (à mettre sur CHAQUE montage, Axel 30/09)** : ce que le hook / la liaison NOMME arrive à l'écran,
  toujours le même mouvement (grande carte, entre par la droite, repart par la gauche) et le même bruitage (woosh +
  déclencheur photo si image + glissé de sortie). Matrice = `usine/illustrations.json` : par hook et par liaison, mots
  d'entrée / de sortie + type de média (fille, garcon, avatar, pub, produit, demo). `demo` / `avatar` / `pub` montrent le
  MÊME résultat que la démo (`demoMedia`) : C-IMGIA-02/03 = garçons, 06/07 = filles, C-OMNI-01/02/03 = Clio → Porsche
  (HK-O2-0a), C-SADS-01 = CIAO, C-SADS-02 = parfum. Un hook « influenceuse » (H12, H13, H21) ne va qu'avec une démo de
  filles. Nouvelle brique ou nouvelle démo → compléter le JSON. Vérifier dans le log les lignes « illustration (…) » et
  les « ⚠ illustration ignorée » (mot introuvable = Whisper a entendu autre chose → corriger les mots d'entrée).
  À la main : `--illus "fichier|entrée|sortie;fichier|entrée"`.
  Garde-fous (30/09) : l'avatar OUVRE toujours (aucune illustration avant 0,8 s) ; durée mini à l'écran 1,5 s (image) /
  2,6 s (vidéo) ; deux illustrations qui se suivent = la première repart quand la seconde arrive ; le texte choc ne se
  pose jamais sur la bande des sous-titres.
- Mots affichés : un mot-outil « éclair » (≤ 3 lettres, ≤ 0,05 s) absent du texte = invention de Whisper, retiré (« Si TU
  t'es ») ; un mot court du texte avalé par Whisper entre deux mots reconnus est remis (« nouvelle ÈRE IA » entendu
  « nouvelle RIA »). Toujours relire `OUT.mp4.words.json` contre le texte de la brique.
- Niveau sonore : calage final automatique à −16 LUFS (ligne « niveau sonore » du log).
- `--choc-size 62` : taille du texte choc forcée (défaut 45-52 px ; VF-0004 : « plus gros »).
- `--subs-style boite` : sous-titres en pastilles blanches texte noir (brique S21) ; défaut `contour` (S02).

### Ce que build.mjs fait tout seul (réglages validés, ne pas refaire à la main)
1. **Voix** : hook, démo, CTA à la suite, jamais superposées ; loudnorm −16 LUFS ; 0,5 s de respiration après le hook.
2. **Transitions simples et RAPIDES** : slide (push) de **0,25 s** qui part **0,08 s après le dernier mot** (hook ou liaison → démo, démo → CTA). Jamais d'avatar ni d'image figés. Pas de fondu au noir.
   **Le CTA n'arrive qu'APRÈS le dernier mot de la démo** (Axel 29/09) : le glissement part au dernier mot + 0,35 s, le
   CTA joue dans le mouvement (aucune image figée : l'ancienne version tenait la démo puis l'avatar, « horrible »). Hook : léger zoom avant continu 1,00 → 1,07.
3. **Bruitages** : whoosh (−4 dB) + impact (−7 dB) sur chaque transition (`render-worker/assets/sfx/`).
4. **Musique de fond pas trop forte** : −11 dB, fondu d'entrée 0,6 s / sortie 0,9 s, **baissée automatiquement sous la
   voix** (sidechain), coupée à la fin de la vidéo ; limiteur final 0,95.
5. **Sous-titres** mot à mot, blancs contour noir, **sans aucune ponctuation** (ni . ni , ni ! ni «»), **y compris pendant le texte du hook** ; **groupes aux moments
   clés** : la dernière phrase avant chaque transition (fin du hook / de la liaison, fin de la démo) et le début du CTA
   jusqu'à « commentaire » (« MARQUE SITE EN COMMENTAIRE ») s'affichent en bloc, chaque mot s'allume quand il est dit,
   puis retour au mot à mot. Dans un groupe, **les mots arrivent un par un** quand ils sont dits, chacun monte du bas et
   se pose (jamais toute la phrase d'un coup). Mots affichés = texte exact de la brique aligné sur les temps de Whisper. Voix d'avatar (hook, liaison, CTA) : même chaîne (EQ + compression + −16 LUFS) pour un
   grain homogène entre briques enregistrées à des moments différents.
6. **Hook soigné** : format **F03 par défaut** (texte choc au-dessus de la tête + sous-titres blancs). **Jamais de
   jaune** (F02 / F04 écartés : Axel n'aime pas). `--format auto` = ancienne rotation. Détail des formats (format tiré en rotation pour récolter de la data, `usine/formats.js`) :
   F01 sous-titres seuls · F02 texte choc 0-3 s + gros sous-titres colorés · F03 texte choc + sous-titres normaux ·
   F04 gros sous-titres colorés. Texte choc = banque validée TH01–TH19, en zone sûre, **jamais sur un visage**, visible
   dès la frame 0 (= couverture). Forcer : `--format F02 --choc TH05`.
   **Emojis = ceux d'Apple, jamais d'autres** (Axel 30/09) : captions.mjs remplace chaque emoji par l'image officielle
   (`emoji-datasource-apple@15.1.2`, 64 px, jsDelivr) ; Noto seulement si le téléchargement échoue.
7. **CTA** : grain + léger tremblement « selfie » (casse le côté IA figé).
7b. **Bruitages liés à l'action** en plus des transitions : pop quand le texte du hook apparaît, swish quand un groupe
   de sous-titres s'affiche, woosh (+ déclencheur photo si image) à l'entrée du B-roll, et dans la démo clic / magie /
   succès d'après les mots dits (clique, sélectionne… / génère, crée… / voilà, résultat…), 2,5 s d'écart mini, 5 maxi.
8. Écrit `OUT.mp4.format.json` (format, texte choc) → repris par `publish-qc.mjs`.

## 4. Contrôler avant d'envoyer (toujours regarder, jamais seulement le log)

**Axel ne doit JAMAIS trouver une erreur que j'aurais pu voir** (29/09 : « tu peux pas faire chaque vidéo toi-même pour
qu'elle soit clean directement ? »). Avant chaque envoi :
1. **Relire TOUS les mots** des sous-titres (`<dossier build-*>/allWords.json`, groupes entre crochets) et les comparer à
   ce qui est dit : hook / liaison = `meta.transcript` de la brique, CTA = `meta.transcript` corrigé par `fixCta`
   (JAMAIS la légende réécrite de cta-captions.json : elle ne correspond pas à l'audio). Aucun « » ni mot déformé.
2. **Planche d'images** aux moments à risque : frame 0, groupe du hook en construction, entrée / sortie du B-roll,
   transition démo → CTA (avant / pendant / après), groupe du CTA.
3. **Son** : ≈ −16 LUFS ; musique qui colle à la vidéo (claire et enjouée pour une démo produit ; pas M04 Monuments,
   trop sombre) ; aucun bruitage sans action à l'écran (pas de bruitages « d'action » dans la démo).

```bash
for t in 0.1 1.5 3 6 12 20 28; do ffmpeg -v error -y -ss $t -i OUT.mp4 -vframes 1 -vf scale=270:-1 f$t.jpg; done   # planche
ffmpeg -i OUT.mp4 -af ebur128 -f null - 2>&1 | grep "I:"                                                          # ≈ −14 à −16 LUFS
```
- Frame 0 jamais blanche ni noire (c'est la couverture TikTok / Reels).
- Sous-titres lisibles, pas sur la bouche ni hors zone sûre ; pas de mot fantôme.
- Mains propres sur le hook et le CTA (doigts tordus → refaire la brique sur une autre photo).
- Musique audible mais sous la voix ; whoosh calé sur la transition, pas après.
- Fin propre : le CTA finit sa phrase, pas de silence mort.

## 5. Livrer

- **Aucune vidéo sur le Mac d'Axel** (disque plein 30/09) : rendu dans le scratchpad → upload `factory-media/final/` →
  `rm` du fichier local. Axel regarde via le kit ou le lien public Supabase.
- **Nom = ID complet de la recette** (Axel 30/09), dans cet ordre, les parties absentes sautées :
  `VF-0001_<photo>_<hook>_<liaison>_<démo>_<CTA>_<musique>_<sous-titres>_<texte choc>_<transformation>` →
  `VF-0004_A2-8_H14_L70_C-IMGIA-07_CTA-AVATAR_M01_S21_TH15`, `VF-0003_A1-8_H23_C-OMNI-01_CTA-PLAN_M06_S02_TH07_HK-O2-0a`.
  Sous-titres = ID de brique (S02 contour, S21 boîte). Le kit affiche ce nom tel quel.
- Données : `factory_posts` (kit : video_url + combo complet : vf, photo, hook, liaison, contenu, cta, musique,
  sous_titre, format, texte_choc, transformation, broll) ET `factory_qc` (status `approved`, route `manual`,
  **template = VF-xxxx**, brick_combo = clés de COMBO_KEYS seulement : voice, avatar, photo, hook, liaison, contenu, cta,
  musique, sous_titre, assemblage + format / texte_choc ; poster = frame 0 dans `final/`). Le dashboard compte en stock
  les approuvées dont le VF n'est pas encore programmé / posté dans le kit.
- Validé → `node usine/publish-qc.mjs … --bricks bricks.json` : QC technique (`qc.mjs`) + vision, dépose la vidéo et un
  poster dans factory-media, et prépare la ligne `factory_qc` (status `pending`, comboJson = { voice, avatar, hook,
  liaison?, contenu, cta, musique? } + format / texte_choc lus dans `OUT.mp4.format.json`). Sans clé service en local, le
  script IMPRIME la ligne : l'insérer avec `supabase db query --linked`. Axel valide ensuite dans Production › revue QC.
- La vidéo approuvée alimente le dashboard (En stock, jours de contenu) puis le kit de publication (`factory_posts`,
  légende = CTA complet de `usine/cta-captions.json` + 3 hashtags max, jamais de fournisseur).

## Fait le 29/09 (retours d'Axel sur les 2 vidéos test)
Zoom avant sur le hook, groupes de sous-titres aux moments clés, sous-titres pendant le texte choc, plus de jaune,
CTA après la fin de la démo, chaîne voix commune, liaison + B-roll « regarde ça » natifs, bruitages liés à l'action.

## Encore à faire
- B-roll : en faire des briques en base (kind `broll`, tags produit / static ad / UGC) pour les choisir automatiquement.
- ~~Stockage : vidéo programmée / postée supprimée de Supabase~~ FAIT 30/09 : le kit appelle `factory-release` quand
  Axel confirme (MP4 de `final/` seulement, la recette reste). Ne JAMAIS toucher aux briques (`variants/`, `hooks/`, `ctas/`, `demos/`).
- Commande A→Z en lot (choix des briques, musique validée au hasard, rendu, QC auto, upload, kit) ; rendu sur Railway.
