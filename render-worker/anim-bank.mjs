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
  // ── PAQUET 1 (#157) — la qualité, le temps, la diffusion ──
  { name: 'quality', desc: "LA MEME IMAGE, FLOUE PUIS NETTE, separees par une ligne qui balaie. « la meilleure qualite du marche », « c'est net », « regarde la difference ». On VOIT la difference au lieu de la lire." },
  { name: 'hd',      desc: "UN BADGE DE QUALITE qui claque en grand : 4K, 1080p, HD. Mets la mention dans items[0].text. « en 4K », « qualite maximale »." },
  { name: 'podium',  desc: "UN PODIUM a trois marches, la premiere monte en tete. « le meilleur du marche », « numero un », « devant tout le monde »." },
  { name: 'star',    desc: "CINQ ETOILES qui se remplissent une a une. « ils adorent », « 5 etoiles », « les meilleurs avis »." },
  { name: 'speed',   desc: "UN COMPTEUR DE VITESSE dont l'aiguille part a fond. « ultra rapide », « en quelques secondes », « la vitesse »." },
  { name: 'hourglass', desc: "UN SABLIER qui se vide. Le temps qui passe SANS l'horloge — utilise-le quand `clock` a deja servi, ou pour une attente." },
  { name: 'deadline',  desc: "UN CALENDRIER dont UNE date s'entoure et pulse. « avant vendredi », « la date limite », « il te reste X jours »." },
  { name: 'share',   desc: "UN PARTAGE : le fichier part vers plusieurs contacts. « partage-le », « envoie-le a un pote », « fais tourner »." },
  { name: 'dm',      desc: "UN MESSAGE PRIVE qui arrive dans la conversation. « je t'envoie ca en prive », « en DM », « je te reponds »." },
  { name: 'bell',    desc: "UNE CLOCHE DE NOTIFICATION qui sonne, avec sa pastille. « active les notifications », « tu recois une alerte »." },
  { name: 'crowd',   desc: "UNE FOULE de silhouettes qui apparait par vagues. « des milliers de personnes », « tout le monde », « ton audience »." },
  { name: 'viral',   desc: "UN POINT QUI SE PROPAGE a tout un reseau, de proche en proche. « ca devient viral », « ca se partage tout seul »." },
  { name: 'scrollstop', desc: "UN TELEPHONE qui defile PUIS SE FIGE net, pouce a l'appui. « ils arretent de scroller », « accrocher en 2 secondes »." },
  { name: 'retention',  desc: "DEUX COURBES DE RETENTION : celle qui s'effondre (pointilles) et la tienne qui tient haut. « ils regardent jusqu'au bout »." },
  { name: 'abtest',  desc: "DEUX VARIANTES A ET B, l'une est encadree comme gagnante. « on teste deux versions », « celle qui marche le mieux »." },

  // ── PAQUET 2 (#157) — l'argent, l'outil, la methode ──
  { name: 'roi',     desc: "CE QUI ENTRE ET CE QUI SORT : 1 EUR d'un cote, 5 EUR de l'autre, relies par une fleche. « ton retour sur investissement », « tu mets 1 tu recuperes 5 »." },
  { name: 'save',    desc: "UNE TIRELIRE qui se remplit de pieces. « tu economises », « ca te coute moins cher », « sans depenser »." },
  { name: 'free',    desc: "UNE ETIQUETTE GRATUIT qui claque en biais. « c'est gratuit », « offert », « sans payer »." },
  { name: 'plan',    desc: "TROIS CARTES DE PRIX, celle du milieu ressort. « il y a trois formules », « l'offre du milieu », « choisis ton plan »." },
  { name: 'crown',   desc: "UNE COURONNE qui se pose, avec son halo. « la version premium », « le plan Elite », « le haut de gamme »." },
  { name: 'robot',   desc: "UN PETIT ROBOT qui s'anime : antenne, yeux qui clignent. « l'IA le fait pour toi », « c'est automatique », « un robot qui bosse »." },
  { name: 'brain',   desc: "UN CERVEAU dont des zones s'allument. « l'IA comprend », « ca reflechit », « le cerveau du systeme »." },
  { name: 'magic',   desc: "UNE BAGUETTE qui transforme un bloc terne en bloc colore, avec des etincelles. « et la ca devient magique », « en un coup de baguette »." },
  { name: 'filter',  desc: "UN TAMIS : beaucoup de choses entrent, UNE SEULE ressort. « on garde que le meilleur », « on filtre », « le tri »." },
  { name: 'layers',  desc: "DES CALQUES qui se posent les uns sur les autres. « on empile les couches », « le montage », « on ajoute par-dessus »." },
  { name: 'before',  desc: "LE MEME VISUEL QUI CHANGE, revele par une glissiere qui descend. « avant / apres », « regarde la transformation ». (`compare` pose deux plans COTE A COTE, pas la meme chose.)" },
  { name: 'badge',   desc: "UN SCEAU qui se pose avec sa coche. « c'est certifie », « valide », « garanti », « verifie »." },
  { name: 'trend',   desc: "UN ESCALIER DE BARRES qui montent + une fleche vers le haut. « ca monte », « la tendance », « de mieux en mieux »." },
  { name: 'template', desc: "UN GABARIT qui se duplique en deux copies. « pars d'un modele », « duplique », « le meme format a chaque fois »." },
  { name: 'record',  desc: "LE BOUTON D'ENREGISTREMENT qui pulse au-dessus d'une onde vivante. « tu enregistres ta voix », « appuie sur rec », « ta prise de son »." },
  { name: 'lock',    desc: "la securite, l'acces reserve, ce qui se debloque, une cle." },
]

export const ANIM_NAMES = BANK.map((b) => b.name)

// le bloc que lit le modèle, régénéré dans l'orchestrateur par sync-anim-bank.mjs
export const bankPrompt = () =>
  BANK.map((b) => `    ${b.name.padEnd(9)}— ${b.desc}`).join('\n')
