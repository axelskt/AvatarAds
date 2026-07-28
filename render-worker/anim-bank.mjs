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
  { name: 'deadline',  desc: "UN CALENDRIER dont UNE date s'entoure et pulse. « avant vendredi », « la date limite », « il te reste X jours »." },
  { name: 'crowd',   desc: "UNE FOULE de silhouettes qui apparait par vagues. « des milliers de personnes », « tout le monde », « ton audience »." },
  { name: 'viral',   desc: "UN POINT QUI SE PROPAGE a tout un reseau, de proche en proche. « ca devient viral », « ca se partage tout seul »." },
  { name: 'scrollstop', desc: "UN TELEPHONE qui defile PUIS SE FIGE net, pouce a l'appui. « ils arretent de scroller », « accrocher en 2 secondes »." },
  { name: 'abtest',  desc: "DEUX VARIANTES A ET B, l'une est encadree comme gagnante. « on teste deux versions », « celle qui marche le mieux »." },

  // ── PAQUET 2 (#157) — l'argent, l'outil, la methode ──
  { name: 'roi',     desc: "CE QUI ENTRE ET CE QUI SORT : 1 EUR d'un cote, 5 EUR de l'autre, relies par une fleche. « ton retour sur investissement », « tu mets 1 tu recuperes 5 »." },
  { name: 'free',    desc: "UNE ETIQUETTE GRATUIT qui claque en biais. « c'est gratuit », « offert », « sans payer »." },
  { name: 'plan',    desc: "TROIS CARTES DE PRIX, celle du milieu ressort. « il y a trois formules », « l'offre du milieu », « choisis ton plan »." },
  { name: 'layers',  desc: "DES CALQUES qui se posent les uns sur les autres. « on empile les couches », « le montage », « on ajoute par-dessus »." },
  { name: 'badge',   desc: "UN SCEAU qui se pose avec sa coche. « c'est certifie », « valide », « garanti », « verifie »." },
  { name: 'trend',   desc: "UN ESCALIER DE BARRES qui montent + une fleche vers le haut. « ca monte », « la tendance », « de mieux en mieux »." },
  { name: 'template', desc: "UN GABARIT qui se duplique en deux copies. « pars d'un modele », « duplique », « le meme format a chaque fois »." },
  { name: 'record',  desc: "LE BOUTON D'ENREGISTREMENT qui pulse au-dessus d'une onde vivante. « tu enregistres ta voix », « appuie sur rec », « ta prise de son »." },
  { name: 'lock',    desc: "la securite, l'acces reserve, ce qui se debloque, une cle." },

  // ── PAQUET 3 (#157) — le geste, pas l'icone ──
  // Axel a supprime douze animations du paquet 2 : cloche, couronne, cerveau,
  // robot, sablier, baguette… toutes le meme defaut, UNE ICONE POSEE SUR UN FOND.
  // Celles-ci montrent une action qui se deroule. Regle pour la suite : si
  // l'animation tient sur une image fixe, elle n'a rien a faire dans la banque.
  { name: 'dropzone', desc: "UN FICHIER QUI TOMBE DANS UNE ZONE EN POINTILLES. « tu deposes ton audio », « glisse ta video », « tu l'importes »." },
  { name: 'render',  desc: "UN APERCU QUI SE REMPLIT pendant qu'une barre de progression avance. « ca genere », « pendant que ca calcule », « laisse tourner »." },
  { name: 'crop',    desc: "UN CADRE PAYSAGE QUI SE RESSERRE AU FORMAT VERTICAL. « on passe en 9:16 », « au bon format », « recadre pour TikTok »." },
  { name: 'silence', desc: "UNE ONDE AUDIO DONT LE SILENCE DISPARAIT ET QUI SE RECOLLE. « on enleve les blancs », « les silences sautent », « le derush »." },
  { name: 'chat',    desc: "UNE CONVERSATION : la question part, la reponse de l'IA s'ecrit dessous. « tu lui demandes », « tu ecris ce que tu veux », « tu lui dis »." },
  { name: 'dashboard', desc: "UN TABLEAU DE BORD : les tuiles se posent et la courbe se trace. « tes stats », « ton tableau de bord », « tu suis tes resultats »." },
  { name: 'translate', desc: "UNE PHRASE FRANCAISE QUI BASCULE EN ANGLAIS, deux cartes FR puis EN. « dans une autre langue », « traduit », « a l'international »." },
  { name: 'bgswap', desc: "LE DECOR QUI SE REMPLACE DERRIERE LA PERSONNE, la personne ne bouge pas. « tu changes le fond », « un autre decor », « le detourage »." },
  { name: 'hook',    desc: "LE DEBUT D'UNE TIMELINE QUI S'ALLUME avec la mention 3s. « les 3 premieres secondes », « ton hook », « l'accroche »." },
  { name: 'export',  desc: "UN CLIP QUI DESCEND EN FICHIER MP4 PRET. « tu recuperes ta video », « tu l'exportes », « tu la telecharges »." },
  { name: 'checklist', desc: "UNE LISTE DONT LES LIGNES SE COCHENT UNE PAR UNE. « tout est inclus », « tu as tout », « rien a rajouter »." },

  // ── PAQUET 4 (#157) — du DETAIL, pas des aplats ──
  // Axel a retire quatre animations du paquet 3 : quatre rectangles orange nus,
  // une silhouette grise, un chiffre seul, un pave de texte. Meme defaut que les
  // douze du paquet 2 : une forme pleine sans rien dedans, ou un glyphe isole.
  // Regle : chaque bloc porte de la matiere — lignes de texte, pastilles,
  // vignettes, chiffres — comme une interface qu'on regarde vraiment.
  { name: 'library', desc: "UNE GRILLE DE VIGNETTES avec leurs titres, l'une d'elles ressort. « ta bibliotheque », « tous tes rushs », « ce que tu as deja »." },
  { name: 'queue',   desc: "UNE FILE DE RENDUS qui se valident un par un, coche apres coche. « ca tourne en fond », « la file d'attente », « pendant ce temps »." },
  { name: 'notif',   desc: "DES BANNIERES DE NOTIFICATION qui s'empilent sur l'ecran. « ca n'arrete pas de sonner », « les notifications tombent »." },
  { name: 'comments', desc: "UN FIL DE COMMENTAIRES qui defile, avatars et coeurs. « les gens reagissent », « regarde les commentaires », « ils repondent »." },
  { name: 'timeline', desc: "LA TIMELINE DU MONTAGE : piste video coupee, onde audio, sous-titres, la tete de lecture passe. « le montage », « je monte la video »." },
  { name: 'results', desc: "UNE RECHERCHE QUI S'ECRIT ET SES RESULTATS qui tombent. « tu cherches », « tu tapes ca et tu trouves », « les resultats »." },
  { name: 'profile', desc: "UN PROFIL SOCIAL : photo, compteur d'abonnes qui grimpe, grille de posts. « ton compte », « tes abonnes », « ta page »." },
  { name: 'invoice', desc: "UNE FACTURE dont les lignes s'inscrivent et le total tombe. « la facture », « ce que ca coute », « le devis »." },
  { name: 'settings', desc: "UN PANNEAU DE REGLAGES dont les interrupteurs basculent un par un. « tu regles », « les parametres », « tu actives ce que tu veux »." },
  { name: 'versus',  desc: "DEUX COLONNES FACE A FACE, croix d'un cote, coches de l'autre. « eux et toi », « la difference », « au lieu de faire ca »." },
  { name: 'thumb',   desc: "UNE MINIATURE DE VIDEO avec sa duree, son titre et son compteur de vues. « la miniature », « cette video a fait X vues »." },
  { name: 'leaderboard', desc: "UN CLASSEMENT dont TA ligne remonte a la premiere place. « passer devant », « etre premier », « depasser les autres »." },
  { name: 'pay',     desc: "UN PAIEMENT QUI PASSE : le recapitulatif, la carte, le bouton, la coche verte. « ils paient », « le paiement passe », « tu encaisses »." },
  { name: 'sales',   desc: "DES NOTIFICATIONS DE VENTE qui tombent avec leur montant. « les ventes tombent », « ca commande », « chaque jour des commandes »." },
  { name: 'folder',  desc: "UN DOSSIER QUI S'OUVRE et laisse sortir ses documents en eventail. « tes fichiers », « tout est range la », « ton dossier »." },

  // ── PAQUET 5 (#157) — l'outil et la vente ──
  { name: 'booking', desc: "UN AGENDA DE LA SEMAINE dont UN creneau se reserve. « il prend rendez-vous », « ton agenda se remplit », « il reserve »." },
  { name: 'form',    desc: "UN FORMULAIRE dont les champs se remplissent, puis le bouton part. « ils remplissent le formulaire », « ils laissent leur mail »." },
  { name: 'donut',   desc: "UN ANNEAU decoupe en parts avec sa legende. « la repartition », « X pour cent de », « la moitie de mes clients »." },
  { name: 'map',     desc: "UNE CARTE ou les epingles tombent une a une. « partout dans le monde », « dans tous les pays », « des clients partout »." },
  { name: 'mixer',   desc: "UNE TABLE DE MIXAGE : les curseurs montent, les vu-metres bougent. « je regle le son », « le mixage », « les niveaux »." },
  { name: 'review',  desc: "UNE CARTE D'AVIS : photo, nom, cinq etoiles qui se remplissent, le temoignage. « leurs avis », « ils temoignent », « ce qu'ils en disent »." },
  { name: 'upgrade', desc: "UNE CARTE QUI PASSE EN PRO et debloque ses options une par une. « tu passes en Pro », « tu montes de plan », « la version superieure »." },
  { name: 'storyboard', desc: "DES PLANS NUMEROTES qui se posent en sequence, avec leur legende. « plan par plan », « le scenario », « la structure de la video »." },
  { name: 'discount', desc: "UN PRIX QUI SE BARRE et le nouveau qui tombe avec sa pastille. « moins cinquante pour cent », « le prix barre », « en promo »." },
  { name: 'waitlist', desc: "DES INSCRITS QUI S'AJOUTENT en file, le compteur grimpe. « la liste d'attente », « ils s'inscrivent », « deja mille personnes »." },
  { name: 'music',   desc: "DEUX PISTES : la voix, et la musique dont le volume passe DESSOUS. « la musique de fond », « je baisse la musique », « sous la voix »." },
  { name: 'bio',     desc: "UN PROFIL, LE LIEN EN BIO qu'on tape, et la page qui monte. « le lien en bio », « clique sur le lien », « c'est dans ma bio »." },

  // ── PAQUET 6 (#157) — la mecanique sociale : ce qui se passe AUTOUR du post ──
  { name: 'keyword', desc: "UN COMMENTAIRE AVEC LE MOT-CLE, et le message prive qui part. « commente le mot », « ecris-moi X en commentaire », « tape le mot »." },
  { name: 'automation', desc: "UN FLUX AUTOMATIQUE : le declencheur, la condition, les deux branches. « c'est automatique », « le systeme s'en occupe », « ca tourne tout seul »." },
  { name: 'carousel', desc: "UN CARROUSEL dont les slides defilent, les points suivent. « le carrousel », « slide par slide », « fais defiler »." },
  { name: 'poll',    desc: "UN SONDAGE dont les deux barres se remplissent avec leur pourcentage. « ils votent », « le sondage », « demande-leur leur avis »." },
  { name: 'story',   desc: "DES STORIES : les anneaux en haut, la barre qui se remplit. « en story », « tu postes en story », « les stories »." },
  { name: 'hashtag', desc: "UNE LISTE DE HASHTAGS avec leur nombre de publications. « les hashtags », « les bons mots-cles », « ce qui est cherche »." },
  { name: 'schedule', desc: "UN CALENDRIER dont les creneaux se remplissent de publications. « c'est programme », « tu planifies ta semaine », « tout est prevu »." },
  { name: 'pin',     desc: "UN COMMENTAIRE QUI REMONTE EN HAUT avec sa punaise. « le commentaire epingle », « je l'epingle », « en haut des commentaires »." },
  { name: 'qr',      desc: "UN QR CODE qu'un trait balaie, et la page qui s'ouvre a cote. « scanne le code », « le QR code », « tu scannes et t'y es »." },
  { name: 'wizard',  desc: "UN ASSISTANT EN TROIS ETAPES : la barre avance, les pastilles s'allument. « en trois etapes », « tu te laisses guider », « etape par etape »." },

  // ── PAQUET 7 (#157) — LES DOMAINES D'ACTIVITE ──
  // La banque ne parlait que creation de contenu. Ses utilisateurs vendent des
  // produits, tradent, editent des logiciels, louent des biens : un e-commercant
  // qui dit « mon panier moyen » n'avait rien a mettre a l'ecran.
  { name: 'product', desc: "E-COMMERCE — UNE FICHE PRODUIT : le visuel, le nom, le prix, le bouton d'ajout au panier. « mon produit », « cet article », « ce que je vends »." },
  { name: 'cart',    desc: "E-COMMERCE — UN PANIER : les articles, les quantites, le total qui s'affiche. « le panier moyen », « ils ajoutent au panier », « la commande »." },
  { name: 'delivery', desc: "E-COMMERCE — UN SUIVI DE LIVRAISON : le colis avance, les etapes se cochent. « la livraison », « le colis part », « ils recoivent en 48 h »." },
  { name: 'sizes',   desc: "E-COMMERCE — LES DECLINAISONS : les tailles et les couleurs, celles qu'on choisit s'encadrent. « toutes les tailles », « plusieurs coloris »." },
  { name: 'candles', desc: "TRADING — DES BOUGIES JAPONAISES qui se dessinent une a une, vertes et rouges. « le graphique », « la bougie », « ca monte sur le chart »." },
  { name: 'portfolio', desc: "TRADING — UN PORTEFEUILLE : la valeur totale, la variation, les lignes d'actifs. « mon portefeuille », « mes positions », « ce que ca vaut »." },
  { name: 'order',   desc: "TRADING — PASSER UN ORDRE : achat ou vente, le prix, la quantite, valider. « je passe un ordre », « j'achete », « je prends position »." },
  { name: 'pnl',     desc: "TRADING — LA COURBE DE PERFORMANCE qui se trace avec son pourcentage. « le rendement », « la performance », « depuis le debut »." },
  { name: 'mrr',     desc: "SAAS — LE REVENU RECURRENT : le montant, et les mois qui montent en barres. « le MRR », « l'abonnement mensuel », « le revenu recurrent »." },
  { name: 'churn',   desc: "SAAS — LA RETENTION qui fuit : les barres se vident, le pourcentage en rouge. « le churn », « ils se desabonnent », « on en perd »." },
  { name: 'onboarding', desc: "SAAS — L'ACTIVATION : les taches se cochent, le pourcentage monte. « l'onboarding », « la prise en main », « les premieres etapes »." },
  { name: 'integrations', desc: "SAAS — DES OUTILS QUI SE BRANCHENT sur un coeur central. « les integrations », « ca se connecte a tout », « compatible avec »." },
  { name: 'property', desc: "IMMOBILIER — UNE ANNONCE : la photo, le prix, les pieces et les metres carres. « ce bien », « l'appartement », « je le mets en location »." },
  { name: 'menu',    desc: "RESTAURATION — UNE CARTE : les plats, leurs prix, celui qu'on choisit. « la carte », « le menu », « ce plat-la », « les prix »." },

  // ── PAQUET 8 (#157) — la suite des domaines ──
  { name: 'weight',  desc: "SPORT — UNE COURBE QUI DESCEND avec le chiffre perdu. « j'ai perdu X kilos », « la courbe descend », « les resultats »." },
  { name: 'quote',   desc: "AGENCE / ARTISAN — UN DEVIS : les lignes, le total, la signature qui se trace. « le devis », « ma prestation », « ils signent le devis »." },
  { name: 'flight',  desc: "VOYAGE — UN BILLET : depart, arrivee, l'avion qui traverse, l'horaire. « le vol », « le billet », « je pars a »." },
  { name: 'saving',  desc: "FINANCES — UNE JAUGE D'EPARGNE qui monte vers l'objectif. « l'epargne », « je mets de cote », « l'objectif est atteint »." },

  // ── PAQUET 9 (#157) — LES METAPHORES PHYSIQUES ──
  // Axel a retire dix animations du paquet 8 : « l'idee est la mais pas le
  // design ». Vues cote a cote, le probleme saute aux yeux : `program`,
  // `course`, `quiz`, `brief` sont DES RANGEES ; `macros` et `budget` DES
  // BARRES — la banque en avait deja dix comme ca. Ici rien ne s'empile en
  // liste : ca penche, ca tombe, ca tourne, ca s'emboite, ca pousse. Et comme
  // ce sont des images mentales et non des interfaces, elles valent pour TOUS
  // les domaines a la fois.
  { name: 'liquid',  desc: "UN VERRE QUI SE REMPLIT, le liquide monte avec ses bulles. « ca se remplit », « jusqu'a ras bord », « le reservoir »." },
  { name: 'magnet',  desc: "UN AIMANT qui aspire les points vers lui. « ca attire », « ils viennent a toi », « tu deviens un aimant »." },
  { name: 'explode', desc: "UN BLOC QUI SE DECOMPOSE en pieces, vue eclatee. « on decortique », « piece par piece », « je te detaille tout »." },

  // ── PAQUET 10 (#157) — METAPHORE **ET** MATIERE ──
  // Axel a retire douze des quinze du paquet 9 : `balance` c'etait deux trapezes
  // et un trait, `puzzle` deux rectangles, `merge` deux ronds. J'avais bien
  // change de langage, mais en jetant les rangees j'avais jete la MATIERE avec
  // — or c'est ce qu'il garde depuis le debut. Ici : des metaphores PEUPLEES,
  // avec des graduations, des textures, de la profondeur.
  { name: 'iceberg', desc: "LA POINTE EMERGEE et l'enorme masse sous la ligne d'eau. « ce que tu vois n'est qu'une partie », « le gros du travail est cache »." },
  { name: 'tunnel',  desc: "DES ANNEAUX QUI DEFILENT en profondeur vers une lumiere. « tu traverses », « la lumiere au bout », « la derniere ligne droite »." },
  { name: 'thermometer', desc: "UN THERMOMETRE gradue dont la colonne grimpe. « ca chauffe », « la pression monte », « le niveau explose »." },

  // ── PAQUET 11 (#157) — RETOUR A LA CREATION DE CONTENU ──
  // Bilan honnete : sur trois paquets de metaphores, Axel en a garde cinq sur
  // quarante-cinq. « Reviens dans la creation de contenu » — et il a raison :
  // ce qu'il garde, ce sont TOUJOURS les scenes de son monde. Ici, le metier de
  // la video, en detail.
  { name: 'filmstrip', desc: "UNE PELLICULE avec ses perforations, les vignettes defilent, une se selectionne. « image par image », « les rushs », « je choisis le plan »." },
  { name: 'teleprompter', desc: "UN PROMPTEUR : le texte monte devant l'objectif, la ligne active s'allume. « tu lis ton texte », « le prompteur », « tu n'as plus qu'a lire »." },
  { name: 'script',  desc: "UN SCRIPT dont les lignes s'ecrivent et dont une phrase se surligne. « le script », « ce que tu vas dire », « j'ecris le texte »." },
  { name: 'clapper', desc: "UN CLAP DE CINEMA rempli qui claque. « moteur », « on tourne », « prise deux », « action »." },
  { name: 'retakes', desc: "TROIS PRISES NUMEROTEES, les ratees se barrent, la bonne s'encadre. « on la refait », « la bonne prise », « je garde celle-la »." },
  { name: 'lightsetup', desc: "LE SETUP : camera sur trepied entre deux softbox qui s'allument. « le bon setup », « comment je filme », « l'eclairage »." },
  { name: 'transition', desc: "UN PLAN QUI EN BALAIE UN AUTRE, ligne lumineuse au passage. « et la ca bascule », « la transition », « on enchaine »." },
  { name: 'zoompunch', desc: "LE CADRE QUI SE RESSERRE d'un coup sur un detail qui grossit. « regarde bien ca », « zoom la-dessus », « le detail qui compte »." },
  { name: 'speedramp', desc: "UNE TIMELINE avec sa zone ralentie et sa zone acceleree. « la tu ralentis », « en accelere », « le ralenti sur ce moment »." },
  { name: 'substyle', desc: "TROIS STYLES DE SOUS-TITRES cote a cote, celui qu'on retient s'encadre. « le style de sous-titres », « tu choisis la typo »." },
  { name: 'trendsound', desc: "UN SON TENDANCE : sa forme d'onde, sa courbe d'usage, son compteur. « le son du moment », « le son qui marche », « la tendance »." },
  { name: 'algorithm', desc: "UNE VIDEO QUI SE PROPAGE dans une grille d'ecrans autour d'elle. « l'algo te pousse », « ca part tout seul », « il te met en avant »." },
  { name: 'loop',    desc: "LA LECTURE QUI REPART sans coupure, la fleche circulaire tourne. « ils la regardent en boucle », « ca reboucle », « le replay »." },
  { name: 'preset',  desc: "UN STYLE ENREGISTRE applique a trois videos d'un coup. « un style enregistre », « le meme rendu partout », « mon preset »." },
  { name: 'watermark', desc: "LE LOGO QUI SE POSE dans le coin de la video. « ta marque sur chaque video », « le filigrane », « ton logo dessus »." },
  { name: 'cv',      desc: "RECRUTEMENT — DES CANDIDATURES, celle qu'on retient ressort avec sa coche. « les candidatures », « je recrute », « celui-la je le prends »." },
]

export const ANIM_NAMES = BANK.map((b) => b.name)

// le bloc que lit le modèle, régénéré dans l'orchestrateur par sync-anim-bank.mjs
export const bankPrompt = () =>
  BANK.map((b) => `    ${b.name.padEnd(9)}— ${b.desc}`).join('\n')
