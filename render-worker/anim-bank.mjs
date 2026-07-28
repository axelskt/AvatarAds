// ─────────────────────────────────────────────────────────────────────────────
// LA BANQUE D'ANIMATIONS — SOURCE UNIQUE.
//
// Elle existait en DEUX exemplaires : `ANIMS` dans anim-pack.mjs (ce que le
// moteur sait dessiner) et `ANIMS` dans supabase/functions/orchestrate/index.ts
// (ce que le chef d'orchestre a le droit de demander). Les deux ont divergé :
// `sign`, `tools` et `post` — les trois animations ajoutées pour Axel en #147,
// justement parce que « les animations n'ont aucun rapport avec ce que je dis »
// — n'ont jamais été déclarées côté serveur. Le modèle ne pouvait donc pas les
// demander : sur « les bons outils » il proposait `toggle`, un interrupteur.
//
// Désormais ce fichier fait foi. anim-pack.mjs en dérive sa liste ; le bloc de
// l'orchestrateur est RÉGÉNÉRÉ depuis ici par `node sync-anim-bank.mjs` — il
// porte un marqueur et ne se modifie plus à la main.
//
// `desc` n'est pas un commentaire : c'est le texte que lit le modèle pour
// choisir. Écris ce que l'animation MONTRE (« un entonnoir : beaucoup entrent,
// peu ressortent »), pas ce qu'elle signifie en abstrait.
// ─────────────────────────────────────────────────────────────────────────────

export const BANK = [
  // ── le produit, l'écran, le résultat ──
  { name: 'screen',  desc: "une capture de SON application, cadrée et zoomée sur l'element qu'il nomme, avec un curseur qui clique. Uniquement s'il explique COMMENT FAIRE dans son outil." },
  { name: 'result',  desc: "le RESULTAT fini qui s'affiche : l'image ou la video qui vient d'etre generee, avec un flash et un bouton d'enregistrement. « et voila ce que ca donne »." },
  { name: 'phone',   desc: "le format final vertical, une video qui defile, « sur TikTok / Reels / Shorts »." },
  { name: 'split',   desc: "un split screen, deux choses cote a cote, un ecran qui se coupe en deux." },
  { name: 'avatar',  desc: "la creation d'un avatar, un personnage qui se genere, « ton premier avatar »." },
  { name: 'faceless', desc: "l'anonymat : « sans montrer ton visage », « sans camera », « personne ne sait que c'est toi ». Une tete dont les yeux se font masquer." },
  { name: 'voice',   desc: "une voix, un clonage vocal, un enregistrement, du son." },
  { name: 'cut',     desc: "une timeline qu'on coupe : le montage, la decoupe, « on enleve les blancs »." },
  { name: 'type',    desc: "un texte qui s'ecrit tout seul : un script genere, une IA qui redige. Mets alors la phrase dans items[0].text (34 caracteres max)." },

  // ── la marque, les outils, l'engagement contractuel ──
  { name: 'logo',    desc: "DES QU'IL PRONONCE LE NOM DE SON SITE OU DE SON PRODUIT : le logo s'affiche EN GRAND, plein cadre dans la zone sure. C'est le moment le plus important de la video pour la marque, il ne reste jamais nu. Une seule fois dans la video, au premier passage." },
  { name: 'tools',   desc: "LES OUTILS EUX-MEMES, cote a cote : « les bons outils », « ma stack », « avec X et Y ». Les logos apparaissent l'un apres l'autre — pas un interrupteur, pas une ampoule : les vrais outils." },
  { name: 'copy',    desc: "UNE CLE / UN CODE QU'ON COPIE ET QU'ON EMPORTE AILLEURS : la cle apparait, « Copie » claque, et elle s'envole vers l'autre outil. « tu copies cette cle », « copie ce lien », « tu recuperes ton token ». C'est la TRANSITION entre deux applications." },
  { name: 'connect', desc: "DEUX OUTILS QUI SE BRANCHENT L'UN A L'AUTRE : les deux logos, la prise qui s'enclenche, le voyant qui passe au vert. « X est connecte a Y », « c'est relie », « ils communiquent entre eux », « l'integration est faite ». Choisis-la quand la LIAISON est le sujet — `tools` ne fait que les poser cote a cote." },
  { name: 'sign',    desc: "UN CONTRAT QUI SE SIGNE : le document, la signature qui se trace, le tampon SIGNE. « ils signent », « un contrat », « un deal », « ils te paient »." },
  { name: 'post',    desc: "PUBLIER SUR LES PLATEFORMES : les tuiles des reseaux et la video qui s'envole vers elles. « poster sur les reseaux », « publier partout », « en un clic sur tous tes comptes »." },
  { name: 'upload',  desc: "une carte qui s'envole : mettre en ligne, envoyer un fichier, deposer." },

  // ── l'argent ──
  { name: 'money',   desc: "l'argent, un revenu, un prix, un cout, ce qui est gratuit." },
  { name: 'wallet',  desc: "un portefeuille qui se remplit : ce que ca rapporte." },
  { name: 'countup', desc: "UN CHIFFRE QUI DEFILE de 0 jusqu'a sa valeur, en tres gros. Pour un montant, un nombre de vues, un pourcentage qu'il ANNONCE. Mets le nombre dans \"value\" et l'unite dans \"unit\"." },

  // ── le temps ──
  { name: 'clock',   desc: "la rapidite, le temps gagne, « en 30 secondes », « en 2 minutes »." },
  { name: 'calendar', desc: "une grille qui se remplit : publier regulierement, tous les jours, la constance." },

  // ── la croissance, l'audience ──
  { name: 'grow',    desc: "une croissance, des vues qui montent, un resultat qui progresse." },
  { name: 'views',   desc: "des vues qui grimpent, la portee, « X personnes t'ont vu »." },
  { name: 'engage',  desc: "des commentaires et des coeurs qui montent : l'engagement, les reactions." },
  { name: 'swipe',   desc: "un fil qui defile, le scroll, « les gens scrollent », le feed." },
  { name: 'network', desc: "un reseau, une connexion, une communaute, des gens relies." },
  { name: 'rocket',  desc: "un lancement, un decollage, ce qui explose, devenir viral." },
  { name: 'stack',   desc: "des videos qui s'empilent : le volume, produire en serie, « 10 videos par jour »." },
  { name: 'funnel',  desc: "un entonnoir : beaucoup entrent, peu ressortent." },
  { name: 'bars2',   desc: "deux colonnes comparees : le avant/apres chiffre." },

  // ── la logique, la methode ──
  { name: 'idea',    desc: "une idee, une astuce, une methode, un declic, « le secret c'est... »." },
  { name: 'steps',   desc: "1, 2, 3 : une methode, « il te suffit de », les etapes." },
  { name: 'flow',    desc: "A MENE A B MENE A C : une chaine d'etapes reliees par des fleches. Mets les libelles dans items[].text (3 max, 14 caracteres). Ideal pour « tu fais X, ca te donne Y, et Y te rapporte Z »." },
  { name: 'orbit',   desc: "un centre et des satellites : tout part d'un seul outil." },
  { name: 'list',    desc: "une liste, une bibliotheque, un catalogue, « plus de X scripts / modeles / options »." },
  { name: 'target',  desc: "un objectif, une cible, quelque chose de precis, « exactement »." },
  { name: 'search',  desc: "chercher, analyser, trouver, reperer." },

  // ── l'opposition, le changement d'etat ──
  { name: 'compare', desc: "un avant/apres, deux options opposees, « au lieu de ». Deux visages ou deux ecrans cote a cote, l'un barre, l'autre valide." },
  { name: 'swap',    desc: "une chose remplacee par une autre : « au lieu de », « a la place de », remplacer." },
  { name: 'toggle',  desc: "un interrupteur qui s'allume : activer, « en un clic », ca se met en marche." },
  { name: 'check',   desc: "c'est valide, c'est fait, ca marche, c'est simple, c'est inclus." },
  { name: 'lock',    desc: "la securite, l'acces reserve, ce qui se debloque, une cle." },
]

export const ANIM_NAMES = BANK.map((b) => b.name)

// le bloc que lit le modèle, régénéré dans l'orchestrateur par sync-anim-bank.mjs
export const bankPrompt = () =>
  BANK.map((b) => `    ${b.name.padEnd(9)}— ${b.desc}`).join('\n')
