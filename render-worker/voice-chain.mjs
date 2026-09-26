// voice-chain.mjs — la chaîne voix du module « Nettoyage audio » de l'app, PORTÉE À L'IDENTIQUE.
//
// Pourquoi une copie et pas une réécriture : le 30/07, la chaîne a été réglée
// passe après passe contre les fichiers de référence d'Axel (voir les longs
// commentaires ci-dessous, repris tels quels de app/index.html). La moindre
// « amélioration » ici ferait sortir du serveur un son différent de celui de
// l'app — celui qu'Axel a validé à l'oreille. Les fonctions sont donc copiées
// octet pour octet depuis app/index.html (seul `export` est ajouté), et le banc
// test/audio-clean/parite.test.mjs le vérifie à chaque exécution :
//   · même code (commentaires et blancs mis à part) que dans l'app ;
//   · même sortie, échantillon par échantillon, sur de vrais enregistrements.
// Toute modification de la chaîne se fait D'ABORD dans l'app, puis se reporte ici.
//
// Ajouts propres au serveur, tous en bas du fichier et sans effet sur le son : un
// tampon minimal qui imite l'AudioBuffer du navigateur (les fonctions de l'app en
// attendent un), la quantification 16 bits que l'app fait subir au signal entre
// le débruitage et la chaîne (elle passe par un WAV, _pcmToWavBlob), et un
// raccourci chaineVoix().
//
// Préréglage : celui de l'app par défaut (_acVoicePreset = 'off' : nivellement
// sans couleur — _acNiveauConstant puis limiteur 0,89). Les trois autres
// (natural / podcast / punch : coupe-bas, creux, présence, air, compresseur,
// normalisation, limiteur 0,891) restent disponibles et sont testés pareil.

// ── réglages (copiés de app/index.html) ──
let _acVoicePreset = 'off';   // 'off' | 'natural' | 'podcast' | 'punch'
export const _AC_VOICE_PRESETS = {
  // « Aucun » ne veut pas dire « ne rien faire » : il veut dire PAS DE COULEUR.
  // L'interface propose deux reglages distincts — TRAITEMENT VOIX (le timbre) et
  // « Volume constant » (le niveau) — mais le code n'en avait qu'un : activer le
  // volume imposait aussi l'EQ du preset. Axel : « quand j'active volume constant
  // ca donne un audio pourri ». Il demandait un niveau regulier, il recevait un
  // relookage complet du timbre. « Aucun » nivelle donc sans toucher au spectre :
  // ni coupe-bas, ni creux, ni presence, ni air, ni de-esseur.
  off: { hp: 20, mud: { f: 250, g: 0, q: 1 }, pres: { f: 3500, g: 0, q: 1 }, air: { f: 11000, g: 0 },
         lp: 19500, deess: 0, comp: { th: -24, ratio: 2.2, att: 0.006, rel: 0.15 }, target: -21 },
  // air : l'étagère « beau micro ». Elle était descendue à 9-9,5 kHz en même
  // temps que la cible montait — soit un coup de pouce EN PLEIN dans la zone de
  // dureté (8-10 kHz, les « ss » et « ch »). Elle repart à 11-12 kHz, où elle
  // ajoute de l'air sans ajouter de sifflantes.
  // Le de-esseur etait le dernier ecart avec « Aucun » (qui n'en a pas) : a
  // -4/-6/-7 dB avec un ratio de 6, il serrait fort la bande des sifflantes et
  // c'est ce qui « s'entend traite ». Il descend a -1,5/-2,5/-3,5 : il protege
  // encore des « ss » agressifs, il ne sculpte plus la voix.
  // ── LE NIVEAU N'ETAIT PAS LE COUPABLE ─────────────────────────────────────
  // Les cibles avaient ete descendues a -19,5/-21 LUFS en pensant qu'une voix
  // « poussee au maximum » expliquait ce qu'Axel entend. Mesure du 30/07, sur
  // ses propres fichiers, qui tranche : celui qu'il trouve IDEAL est a
  // -14,5 LUFS avec 2,1 LU de plage, celui qu'il trouve sature est a -20,6 LUFS
  // avec 2,5 LU. Le fichier ideal est donc a la fois PLUS FORT et PLUS COMPRIME.
  // Ni le niveau ni la compression ne sont en cause — c'est la courbe (voir
  // plus bas). Les cibles reviennent donc a ce qui lui plait.
  //
  // Le montage renormalise derriere, mais worker.mjs ne repasse loudnorm que sur
  // une voix hors cible : a -14,5 LUFS elle est dans la fenetre, il applique un
  // simple gain statique et ne touche pas a la dynamique.
  // ── LES COURBES SONT RELEVEES SUR SES FICHIERS, PLUS DEDUITES ─────────────
  // Le 30/07 Axel a fourni le meme enregistrement passe par les trois presets du
  // 27/07 (VOIX4-off / -podcast / -punch) en disant : « voila l'audio traite
  // ideal ». Mesure bande par bande, en absolu, apres compensation de niveau —
  // c'est-a-dire la courbe REELLE de l'egaliseur, pas celle qu'on croit ecrire :
  //
  //     bande      podcast    punch
  //      80 Hz      -1,55     -0,88
  //     160 Hz      -2,15     -1,58
  //     315 Hz      -3,77     -4,27      ← le creux du « carton »
  //     630 Hz      -3,75     -4,56
  //    1250 Hz      -2,12     -2,60
  //    2500 Hz      +0,88     +0,72
  //    5000 Hz      +2,88     +3,06      ← la clarte
  //    8000 Hz      +3,78     +3,96
  //   12500 Hz      +3,89     +4,03
  //
  // Ce preset CREUSE 315-630 Hz de pres de 4 dB et REMONTE tout ce qui est
  // au-dessus de 5 kHz de 3 a 4 dB. Le code faisait l'inverse exact : `mud` avec
  // un gain POSITIF a 180 Hz (donc du bas-medium en plus) et un `air` a +0,6 dB.
  // L'inversion vient d'une session precedente qui a lu « ca donne un audio
  // pourri » comme « il y a trop d'aigus » et a change le SIGNE au lieu de
  // reduire l'exces. Mesure sur sa prise DJI : la chaine ajoutait +2,2 dB dans
  // le 60-120 Hz. Une voix de micro-cravate chargee en grave, c'est exactement
  // ce qu'on entend comme « ca sature » — et aucun test d'ecretage ne le voit.
  //
  // Les valeurs ci-dessous reproduisent la courbe relevee a ±0,5 dB (verifie en
  // rejouant VOIX4-off a travers ces filtres et en re-mesurant les neuf bandes).
  // Ne pas les « ajuster a l'oreille » sans refaire la mesure : c'est comme ca
  // qu'elles se sont inversees.
  //
  // Le creux est un peaking LARGE (Q 0,5) centre a 500 Hz : il couvre 315-1250,
  // ce que deux bandes etroites ne faisaient pas. `pres` reste a zero — dans les
  // fichiers d'Axel la presence vient du shelf, pas d'une bosse a 3 kHz.
  // `deess: 0` = INACTIF, et c'est un constat, pas un renoncement. Le seuil
  // etait exprime en dBFS ABSOLU (-2,5) alors que la bande des sifflantes
  // isolee plafonne 25 a 30 dB plus bas : mesure sur ses deux fichiers, le
  // de-esseur ne reduisait RIEN, jamais, dans aucun preset. Il n'apportait que
  // le retard de son compresseur — donc le peigne. Et VOIX4-podcast, le fichier
  // qu'Axel juge ideal, a ete produit avec ce meme de-esseur inactif : ne rien
  // de-esser reproduit donc exactement ce qu'il valide. `_acDeEsser` reste en
  // place, teste et a phase nulle ; pour l'activer un jour il faudra un seuil
  // relatif a la bande HF (vers -30 dBFS), cale sur un fichier de reference.
  // ── 2e PASSE, SUR LA COMPARAISON DIRECTE DES DEUX SORTIES ─────────────────
  // La 1re passe calait le delta « off -> podcast » (27/07) contre le delta
  // « DJI brut -> nettoye » (actuel). Axel a corrige : ses deux fichiers sont
  // tous les deux passes par PODCAST, l'un avec l'ancienne version, l'autre
  // avec la nouvelle. Comparer un delta de preset avec un delta de chaine
  // entiere (RNNoise compris) n'avait pas de sens.
  //
  // Comparaison directe des deux sorties, a niveau egalise — l'ecart reel :
  //     80 Hz  +1,38   trop de grave
  //    630 Hz  -2,02   creux trop large
  //   2500 Hz  -1,35   medium en retrait
  //   8000 Hz  +1,25   trop d'aigu extreme
  // Le basculement etait trop marque : creux trop bas et trop large, shelf trop
  // fort. Le creux remonte a 360 Hz et se resserre (Q 0,9), la presence revient
  // a 2,5 kHz, le shelf monte a 4,8 kHz et faiblit.
  //
  // Verifie en rejouant VOIX4-off a travers l'ancienne PUIS la nouvelle courbe :
  // ecart residuel <= 0,26 dB sur huit bandes sur neuf (0,75 dB a 2,5 kHz).
  // ── 3e PASSE : le grave est un PLATEAU, pas une bosse ─────────────────────
  // Axel : « bof ». Et pour cause — j'avais monte le coupe-bas de 55 a 115 Hz
  // et le grave etait quand meme remonte. La mesure explique pourquoi : ses deux
  // fichiers ne viennent pas de la meme prise. DJI_02 est intrinsequement PLUS
  // CLAIRE que VOIX4 (-1,8 dB de medium, +2,3 dB a 8 kHz). Une partie de l'ecart
  // que je corrigeais n'etait pas le traitement, c'etait le micro.
  //
  // Ecart corrige de la difference de prise — ce que la chaine faisait de trop :
  //    80-315 Hz   +2,2 a +3,0     trop de grave
  //      2500 Hz   +0,11           deja cale
  //     5-12 kHz   -1,3 a -1,6     pas assez d'air
  //
  // C'est un PLATEAU de grave, pas une bosse : -5,4 dB de 80 a 315 Hz qui
  // remonte vers 0 au-dessus de 1,2 kHz. Un peaking, meme large, ne sait pas
  // dessiner ca — d'ou `mudType: 'lowshelf'`.
  //
  // Courbe absolue visee (vs le preset « off »), et obtenue :
  //     bande    visee   obtenue
  //      80 Hz   -5,44    -5,69
  //     160 Hz   -5,44    -5,57
  //     315 Hz   -4,88    -4,71
  //     630 Hz   -2,96    -3,35
  //    1250 Hz   -1,04    -0,51
  //    2500 Hz   +2,41    +2,91
  //    5000 Hz   +4,07    +3,84
  //    8000 Hz   +4,64    +4,35
  //   12500 Hz   +4,53    +4,39
  // Ecart <= 0,55 dB sur les neuf bandes.
  //
  // ⚠️ MESURER LA DIFFERENCE D'EQ SANS COMPENSATION DE NIVEAU. Avec, un
  // changement global (enlever du grave ET ajouter de l'air) se fait manger par
  // la renormalisation : la 2e passe lisait -1,17 dB la ou l'EQ en appliquait
  // -5,7. Meme source, seul l'egaliseur change => comparaison brute.
  // ── 4e PASSE — LA SEULE MESURE QUI VALAIT ────────────────────────────────
  // Axel a fini par nettoyer LE MEME fichier que sa reference (VOIX4). Meme
  // source, meme duree : la comparaison devient exacte, plus aucune hypothese
  // sur le micro. Verdict, courbe relative de chacun sur cette source :
  //
  //     bande    CIBLE    ce que je sortais    ecart
  //     315 Hz   +11,53         +6,62          -4,91
  //     630 Hz   +11,55         +7,23          -4,32
  //    8000 Hz   +19,08        +19,90          +0,82
  //
  // Je creusais le grave de 4 a 5 dB DE TROP. Mes 2e et 3e passes, calees sur
  // des comparaisons entre deux prises DIFFERENTES (VOIX4 contre DJI), m'ont
  // eloigne de la cible a chaque fois. Le low-shelf, la compensation du
  // debruitage, le coupe-bas a 115 Hz : tout ca corrigeait un ecart de MICRO.
  //
  // On revient donc aux valeurs de la 1re passe, revalidees sur la mesure
  // exacte : ecart residuel +/-0,5 dB en relatif sur les neuf bandes.
  //
  // Le compresseur n'y etait pour rien : teste a -24/2.6, -22/2.2, -20/1.9,
  // -18/1.6 et -16/1.4, c'est le reglage d'origine qui approche le mieux la
  // dynamique de la reference (LRA 2,3 contre 2,1).
  //
  // ⚠️ LA REGLE, APRES QUATRE PASSES : ne comparer que des fichiers issus de la
  // MEME PRISE. Deux enregistrements du meme micro different deja de 2 dB dans
  // l'aigu — assez pour envoyer trois corrections dans le mur.
  // ── 5e PASSE — CALEE SUR LA VRAIE SORTIE DE L'APP, PAS SUR UNE SIMULATION ─
  // Les quatre passes precedentes reglaient l'egaliseur d'apres une simulation
  // ffmpeg qui NE CONTIENT PAS le debruitage. L'app, elle, l'applique. Les
  // reglages etaient donc justes pour un signal que l'app ne produit jamais.
  //
  // Ici la reference de reglage est le fichier qu'AXEL a genere avec l'app, sur
  // la MEME prise que sa cible (VOIX4). Ecart mesure, sortie app contre cible :
  //
  //      80 Hz   +1,16        2500 Hz   -0,28
  //     160 Hz   +0,24        5000 Hz   +0,40
  //     315 Hz   -2,67        8000 Hz   +0,79
  //     630 Hz   -4,06       12500 Hz   +1,06
  //    1250 Hz   -2,00
  //
  // Le creux de `mud` tombait donc 4 dB trop bas APRES le debruitage : RNNoise
  // retire du souffle aigu, ce qui deplace tout l'equilibre. Il passe de -5,0 a
  // -1,4 et remonte a 560 Hz ; l'air redescend de 5,6 a 4,8 ; le coupe-bas
  // monte a 75 Hz pour les 1,2 dB de grave en trop.
  //
  // COMPRESSION : sa sortie mesure 1,1 LU de plage contre 2,1 pour la cible —
  // deux fois trop serree, alors que la meme chaine SANS debruitage donne 2,3.
  // Le ratio descend de 2,6 a 1,6 et le seuil remonte de -24 a -20 dB : le
  // compresseur ne doit plus rattraper ce que le debruitage a deja aplati.
  natural: { hp: 80, mud: { f: 400, g: -3.0, q: 0.95 }, pres: { f: 2500, g: 0, q: 1 }, air: { f: 3600, g: 4.5 }, comp: { th: -22, ratio: 3.0, att: 0.003, rel: 0.11 }, target: -16.5 },
  podcast: { hp: 78, mud: { f: 400, g: -4.2, q: 0.95 }, pres: { f: 175, g: 1.4, q: 0.8 }, air: { f: 3400, g: 6.8 }, comp: { th: -25, ratio: 4.8, att: 0.003, rel: 0.11 }, target: -14.8 },
  punch:   { hp: 75, mud: { f: 400, g: -3.2, q: 0.95 }, pres: { f: 170, g: 2.6, q: 0.8 }, air: { f: 3200, g: 7.8 }, comp: { th: -26, ratio: 5.5, att: 0.003, rel: 0.10 }, target: -14.5 },
};
const _acOpts = { silences: true, denoise: true, voice: true, breath: true };
export const _AC_BRUIT_SEUIL_DB = -38;

// ── _acNiveauConstant (copié de app/index.html) ──
export function _acNiveauConstant(buf, cible = 0){
  const sr = buf.sampleRate, n = buf.length
  const win = Math.round(sr * 0.6)                 // 600 ms : l'echelle de la phrase
  const nb = Math.max(1, Math.ceil(n / win))
  // 1 · le niveau efficace de chaque fenetre, en ignorant les silences.
  //     On releve AUSSI le pic de la fenetre : c'est lui qui bornera le gain
  //     plus bas. Le pic est cherche sur TOUS les echantillons (pas un sur
  //     quatre comme le niveau efficace) — un pic rate, c'est un plafond faux.
  const niv = new Float32Array(nb), pic = new Float32Array(nb)
  const d0 = buf.getChannelData(0)
  for (let k = 0; k < nb; k++) {
    const a = k * win, b = Math.min(n, a + win)
    let s = 0, c = 0, m = 0
    for (let i = a; i < b; i += 4) { const v = d0[i]; s += v * v; c++ }
    for (let i = a; i < b; i++) { const x = Math.abs(d0[i]); if (x > m) m = x }
    niv[k] = c ? Math.sqrt(s / c) : 0
    pic[k] = m
  }
  // 2 · le gain voulu par fenetre, borne a ±12 dB pour ne jamais reveler le bruit
  const MINI = 0.004                               // sous ce niveau c'est du silence
  // ── LA CIBLE EST CELLE DU FICHIER, PAS UNE VALEUR ABSOLUE ─────────────────
  // Elle valait 0,10 en dur, soit -20 dB. Sur une prise a -32,7 dB (le DJI
  // d'Axel), il fallait donc +12,7 dB PARTOUT : mesure, le gain restait colle
  // contre sa butee de +12 dB sur 57,7 % du fichier. La ou il n'y est pas colle,
  // il bouge d'une fenetre a l'autre — et ca s'entend comme un pompage. C'est
  // exactement « ca sature du debut a la fin ».
  //
  // « Volume constant » ne promet pas un NIVEAU, il promet une REGULARITE :
  // « meme niveau du debut a la fin, sans ecraser ». On vise donc la mediane du
  // fichier lui-meme. Une prise faible reste une prise faible — le calage en
  // niveau, c'est le travail du mastering ou du montage, pas le sien.
  //
  // Et la course est bornee a +/-4 dB au lieu de +/-12 : au-dela on ne regularise
  // plus, on reconstruit, et le bruit de fond monte avec la voix.
  const parle = Array.from(niv).filter((v) => v >= MINI).sort((a, b) => a - b)
  const ref = cible || (parle.length ? parle[Math.floor(parle.length / 2)] : 0)
  const MAXG = Math.pow(10, 4 / 20), MING = Math.pow(10, -4 / 20)
  const gw = new Float32Array(nb)
  for (let k = 0; k < nb; k++) {
    gw[k] = (niv[k] < MINI || !ref) ? 1 : Math.min(MAXG, Math.max(MING, ref / niv[k]))
  }
  // 3 · on lisse la courbe : un gain qui saute entre deux fenetres s'entend
  const lisse = new Float32Array(nb)
  for (let k = 0; k < nb; k++) {
    let s = 0, c = 0
    for (let j = Math.max(0, k - 2); j <= Math.min(nb - 1, k + 2); j++) { s += gw[j]; c++ }
    lisse[k] = s / c
  }
  // 3bis · LE PLAFOND, ET IL VIENT APRES LE LISSAGE ───────────────────────────
  // C'est la cause de « ca sature du debut a la fin ». On visait un niveau
  // EFFICACE (0,10) sans jamais regarder le PIC de la fenetre : sur une voix a
  // 24 dB de facteur de crete — une prise DJI, typiquement — atteindre cette
  // cible impose des pics a +2,2 dBFS, au-dessus du plein niveau. Le limiteur
  // derriere rattrapait tout, si bien que le fichier sortait a -1 dBFS avec zero
  // echantillon ecrete : TOUTES les mesures disaient « propre » pendant que
  // l'oreille entendait le limiteur mordre les attaques (-3,2 dB au pire, et
  // 3,4 dB de facteur de crete perdus entre l'entree et la sortie).
  //
  // Chaque fenetre est donc bornee pour que son pic reste sous 0,80 (-1,9 dBFS),
  // avec 0,9 dB de marge sous le plafond du limiteur. On regarde le pic de la
  // fenetre ET de ses voisines, puisque l'etape 4 interpole entre deux centres.
  //
  // ⚠️ APRES le lissage, jamais avant : borne en amont, la moyenne mobile rend a
  // la fenetre le gain de ses voisines et le plafond saute — mesure, le pic
  // restait a +2,22 dBFS, exactement comme sans correctif.
  //
  // Mesure sur une prise DJI brute (77 s, -32,7 dBFS efficace) :
  //   pic avant limiteur  +2,22 dBFS -> -0,10 dBFS
  //   limiteur actif       0,53 %    ->  0,05 % du temps
  //   reduction maximale  -3,23 dB   -> -0,91 dB
  //   facteur de crete     20,5 dB   ->  20,9 dB   (preserve)
  //   regularite            6,70 dB  ->   6,64 dB  (le nivellement fait toujours
  //                                                 son travail)
  const PLAFOND = 0.80
  for (let k = 0; k < nb; k++) {
    const p = Math.max(pic[k], pic[Math.max(0, k - 1)], pic[Math.min(nb - 1, k + 1)])
    if (p > 1e-6) lisse[k] = Math.min(lisse[k], PLAFOND / p)
  }
  // 4 · application, avec interpolation lineaire entre les centres de fenetre
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < n; i++) {
      const pos = i / win - 0.5
      const k0 = Math.max(0, Math.min(nb - 1, Math.floor(pos)))
      const k1 = Math.max(0, Math.min(nb - 1, k0 + 1))
      const t = Math.max(0, Math.min(1, pos - k0))
      d[i] *= lisse[k0] * (1 - t) + lisse[k1] * t
    }
  }
  return buf
}

// ── _acBqJs (copié de app/index.html) ──
export function _acBqJs(d, sr, type, f0, Q, G){
  const A = Math.pow(10, G / 40), w = 2 * Math.PI * f0 / sr;
  const cw = Math.cos(w), sw = Math.sin(w);
  let b0, b1, b2, a0, a1, a2;
  if(type === 'highpass'){
    const al = sw / (2 * Q);
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
    a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
  } else if(type === 'peaking'){
    const al = sw / (2 * Q);
    b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A;
    a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A;
  } else { // highshelf, S = 1
    const al = sw / 2 * Math.SQRT2, sA = Math.sqrt(A);
    b0 = A * ((A + 1) + (A - 1) * cw + 2 * sA * al);
    b1 = -2 * A * ((A - 1) + (A + 1) * cw);
    b2 = A * ((A + 1) + (A - 1) * cw - 2 * sA * al);
    a0 = (A + 1) - (A - 1) * cw + 2 * sA * al;
    a1 = 2 * ((A - 1) - (A + 1) * cw);
    a2 = (A + 1) - (A - 1) * cw - 2 * sA * al;
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for(let i = 0; i < d.length; i++){
    const x = d[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    d[i] = y;
  }
}

// ── _acCompressJs (copié de app/index.html) ──
export function _acCompressJs(d, sr, thDb, ratio, att, rel){
  const aA = Math.exp(-1 / (sr * att)), aR = Math.exp(-1 / (sr * rel));
  const makeup = Math.pow(10, (Math.abs(thDb) * 0.18) / 20);
  let env = 0, gr = 0;
  for(let i = 0; i < d.length; i++){
    const a = Math.abs(d[i]);
    env = a > env ? aA * env + (1 - aA) * a : aR * env + (1 - aR) * a;
    const eDb = 20 * Math.log10(Math.max(1e-9, env));
    const want = eDb > thDb ? (eDb - thDb) * (1 / ratio - 1) : 0;
    gr = want < gr ? aA * gr + (1 - aA) * want : aR * gr + (1 - aR) * want;
    d[i] *= Math.pow(10, gr / 20) * makeup;
  }
}

// ── _acMasterVoice (copié de app/index.html) ──
export async function _acMasterVoice(buf, presetKey){
  const cle = presetKey || _acVoicePreset;
  // « Aucun » garde le chemin court : nivellement sans couleur.
  if (cle === 'off') {
    if (!buf || !buf.length || (!presetKey && !_acOpts.voice)) return buf
    return _acLimitPeaks(_acNiveauConstant(buf), 0.89)
  }
  const P = _AC_VOICE_PRESETS[cle];
  if(!P || !buf || !buf.length || (!presetKey && !_acOpts.voice)) return buf;
  const sr = buf.sampleRate;
  for(let c = 0; c < buf.numberOfChannels; c++){
    const d = buf.getChannelData(c);
    _acBqJs(d, sr, 'highpass', P.hp, 0.7, 0);
    if(P.mud.g)  _acBqJs(d, sr, 'peaking',   P.mud.f,  P.mud.q,  P.mud.g);
    if(P.pres.g) _acBqJs(d, sr, 'peaking',   P.pres.f, P.pres.q, P.pres.g);
    if(P.air.g)  _acBqJs(d, sr, 'highshelf', P.air.f,  0,        P.air.g);
    _acCompressJs(d, sr, P.comp.th, P.comp.ratio, P.comp.att, P.comp.rel);
  }
  // mediane RMS des zones parlees -> cible, gain entier, puis limiteur (0.891)
  return _acNormalizeLoudness(buf, P.target);
}

// ── _acNormalizeLoudness (copié de app/index.html) ──
export function _acNormalizeLoudness(buf, targetDb){
  const d = buf.getChannelData(0);
  const win = Math.round(buf.sampleRate * 0.4);
  const blocks = [];
  for(let i = 0; i < d.length; i += win){
    let s = 0; const e = Math.min(i + win, d.length);
    for(let j = i; j < e; j++) s += d[j] * d[j];
    blocks.push(Math.sqrt(s / Math.max(1, e - i)));
  }
  const spoken = blocks.filter((b) => b > 0.02).sort((a, b) => a - b);
  if(!spoken.length) return buf;
  const med = spoken[Math.floor(spoken.length * 0.5)];
  if(!med) return buf;
  let gain = Math.pow(10, (targetDb - 20 * Math.log10(med)) / 20);
  // ⚠️ ICI SE TROUVAIT LE VRAI DEFAUT, ET IL A COUTE LA SOIREE ENTIERE.
  // Le gain etait bride par le PIC ABSOLU du fichier :
  //     gain = Math.min(gain, 0.891 / peak)
  // Une seule plosive isolee suffisait donc a brider le niveau de TOUT le
  // fichier. Mesure sur la prise VOIX4 : gain voulu x6,43, gain applique x3,02.
  // Il manquait 4,5 dB — exactement l'ecart entre ce que l'app sortait (-19 LUFS,
  // facteur de crete 9,4) et le fichier de reference (-14,5 LUFS, crete 5,40).
  //
  // Le gain demande s'applique donc en entier, et les cretes qui depassent sont
  // rattrapees APRES par un vrai limiteur a lookahead (_acLimitPeaks) — pas en
  // rabotant le volume de l'ensemble.
  //
  // Verifie sur VOIX4-off : -13,9 LUFS / crete 4,73 contre -14,5 / 5,40 pour la
  // reference, et un timbre a +/-2 dB. Avant : -19,0 LUFS / crete 9,40.
  if(Math.abs(gain - 1) < 0.02) return buf;
  for(let c = 0; c < buf.numberOfChannels; c++){
    const chd = buf.getChannelData(c);
    for(let i = 0; i < chd.length; i++) chd[i] *= gain;
  }
  return _acLimitPeaks(buf, 0.891);
}

// ── _acLimitPeaks (copié de app/index.html) ──
export function _acLimitPeaks(buf, ceiling = 0.84, lookMs = 4, relMs = 80){
  const sr = buf.sampleRate, n = buf.length;
  const look = Math.max(1, Math.round(sr * lookMs / 1000));
  const rel  = Math.max(1, Math.round(sr * relMs  / 1000));
  const chs = [];
  for(let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));

  const gain = new Float32Array(n).fill(1);
  let need = false;
  for(let i = 0; i < n; i++){
    let m = 0; for(const d of chs){ const a = Math.abs(d[i]); if(a > m) m = a; }
    if(m > ceiling){ gain[i] = ceiling / m; need = true; }
  }
  if(!need) return buf;
  // lookahead : la baisse est anticipée sur `look` échantillons (rampe douce)
  for(let i = n - 2; i >= 0; i--){
    const g = gain[i + 1] + (1 - gain[i + 1]) / look;
    if(g < gain[i]) gain[i] = g;
  }
  // relâche : on remonte progressivement, jamais d'à-coup
  for(let i = 1; i < n; i++){
    const g = gain[i - 1] + 1 / rel;
    if(gain[i] > g) gain[i] = g;
  }
  for(const d of chs) for(let i = 0; i < n; i++) d[i] *= gain[i];
  return buf;
}

// ── _acDetectDenoised (copié de app/index.html) ──
export function _acDetectDenoised(buf){
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  const win = Math.round(sr * 0.05);
  const rms = [];
  for(let i = 0; i < d.length; i += win){
    let s = 0; const e = Math.min(i + win, d.length);
    for(let j = i; j < e; j++) s += d[j] * d[j];
    rms.push(Math.sqrt(s / Math.max(1, e - i)));
  }
  if(rms.length < 20) return false;
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.10)] || 1e-9;
  const voice = sorted[Math.floor(sorted.length * 0.90)] || 1e-9;
  const floorDb = 20 * Math.log10(Math.max(floor, 1e-9));
  const ratio   = 20 * Math.log10(voice / Math.max(floor, 1e-9));
  return floorDb < -65 || ratio > 55;
}

// ── _acBruitDeFondDb (copié de app/index.html) ──
export function _acBruitDeFondDb(buf){
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  const win = Math.max(1, Math.floor(sr * 0.02));   // fenêtres de 20 ms
  const rms = [];
  for(let i = 0; i + win <= d.length; i += win){
    let s = 0;
    for(let j = i; j < i + win; j += 2) s += d[j] * d[j];
    rms.push(Math.sqrt(s / (win / 2)));
  }
  if(rms.length < 10) return 0;                     // trop court pour juger
  const tri = rms.slice().sort((a, b) => a - b);
  const q = (p) => tri[Math.min(tri.length - 1, Math.floor(p * tri.length))];
  const plancher = q(0.10), voix = Math.max(q(0.90), 1e-6);
  return 20 * Math.log10(Math.max(plancher, 1e-6) / voix);
}
// ══════════════════════════════════════════════════════════════════════════
// Ajouts propres au serveur (rien de ce qui suit ne touche au son)
// ══════════════════════════════════════════════════════════════════════════

// le préréglage que l'app applique quand personne n'a rien choisi
export const PRESET_DEFAUT = _acVoicePreset
export const PRESETS = Object.keys(_AC_VOICE_PRESETS)

// Le strict nécessaire de l'AudioBuffer du navigateur pour les fonctions de
// l'app : sampleRate, length, numberOfChannels, duration, getChannelData(c).
// Les canaux sont des Float32Array, comme dans Web Audio — c'est ce qui garantit
// les mêmes arrondis que dans l'app.
export class TamponAudio {
  constructor(canaux, sampleRate) {
    this._c = canaux.map((c) => (c instanceof Float32Array ? c : Float32Array.from(c)))
    this.sampleRate = sampleRate
    this.length = this._c.length ? this._c[0].length : 0
    this.numberOfChannels = this._c.length
    this.duration = this.sampleRate ? this.length / this.sampleRate : 0
  }
  getChannelData(c) { return this._c[c] }
}

// ── LE PASSAGE PAR LE WAV 16 BITS DE L'APP ──────────────────────────────────
// Dans l'app, le débruitage rend un WAV (_pcmToWavBlob) que le navigateur
// redécode avant la chaîne voix. Ce détour borne le signal à [-1, 1] et le
// quantifie sur 16 bits. On le reproduit : même borne, même quantification
// (DataView.setInt16 tronque vers zéro, NaN → 0), puis la relecture 16 bits →
// flottant du décodeur de Chrome (négatifs / 32768, positifs / 32767).
// Écart avec un signal non quantifié : un demi-pas de 16 bits, soit -96 dB.
// `out` peut être `pcm` lui-même (travail en place, pour épargner la mémoire).
export function allerRetourInt16(pcm, out = new Float32Array(pcm.length)) {
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    let v = Math.trunc(s < 0 ? s * 32768 : s * 32767)
    if (v !== v) v = 0
    out[i] = v < 0 ? v / 32768 : v / 32767
  }
  return out
}

// Signal mono débruité → signal mono masterisé, exactement comme l'app :
// _acMasterVoice(tampon, préréglage). Travaille sur une COPIE (l'entrée reste intacte).
export async function chaineVoix(pcm, sampleRate, preset = PRESET_DEFAUT) {
  if (!Object.prototype.hasOwnProperty.call(_AC_VOICE_PRESETS, preset)) throw new Error('préréglage inconnu : ' + preset)
  const tampon = new TamponAudio([Float32Array.from(pcm)], sampleRate)
  const sortie = await _acMasterVoice(tampon, preset)
  return sortie.getChannelData(0)
}
