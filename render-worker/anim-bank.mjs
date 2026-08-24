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

// ── BANNIES DÉFINITIVEMENT (Axel, 14/08/26) — ne JAMAIS les remettre ─────────
// target, clock, check, versus, hook, calendar, free, steps, twopaths, bars2,
// grow, toggle : des icônes-sur-fond qui ne montrent rien (« si ça tient sur une
// image fixe, ça n'entre pas dans la banque »). Retirées d'ICI et non d'une liste
// de filtrage, pour que le ban vaille pour TOUS les styles (dynamic, apple, word…).
// Leurs templates dorment encore dans anim-pack.mjs mais sont inatteignables :
// chaque moteur vérifie l'appartenance à ANIMS avant de rendre.
export const BANK = [
  // ── le produit, l'écran, le résultat ──
  { name: 'screen',  desc: "une capture de SON application, cadrée et zoomée sur l'element qu'il nomme, avec un curseur qui clique. Uniquement s'il explique COMMENT FAIRE dans son outil. « tu vas dans », « clique sur », « tu selectionnes », « rends-toi dans l onglet », « en haut a droite »." },
  { name: 'result',  desc: "le RESULTAT fini qui s'affiche : l'image ou la video qui vient d'etre generee, avec un flash et un bouton d'enregistrement. « et voila ce que ca donne »." },
  { name: 'phone',   desc: "UN DOIGT QUI FAIT DEFILER un telephone vertical, video apres video. UNIQUEMENT quand il parle de SCROLLER : « ils swipent », « tu scrolles », « il passe a la suivante », « dans le fil ». Pas pour dire simplement « sur TikTok »." },
  { name: 'split',   desc: "un split screen, deux choses cote a cote, un ecran qui se coupe en deux. « cote a cote », « en meme temps », « split screen », « les deux ensemble », « en haut et en bas »." },
  { name: 'avatar',  desc: "la creation d'un avatar, un personnage qui se genere, « ton premier avatar »." },
  { name: 'faceless', desc: "l'anonymat : « sans montrer ton visage », « sans camera », « personne ne sait que c'est toi ». Une tete dont les yeux se font masquer." },
  { name: 'voice',   desc: "une voix, un clonage vocal, un enregistrement, du son. « ta voix », « clone ta voix », « la voix off », « enregistre-toi », « le micro », « parle »." },
  { name: 'cut',     desc: "une timeline qu'on coupe : le montage, la decoupe, « on enleve les blancs »." },
  { name: 'type',    desc: "un texte qui s'ecrit tout seul : un script genere, une IA qui redige. Mets alors la phrase dans items[0].text (34 caracteres max). « le script s ecrit », « il redige pour toi », « le texte apparait », « genere le texte »." },

  // ── la marque, les outils, l'engagement contractuel ──
  { name: 'logo',    desc: "DES QU'IL PRONONCE LE NOM DE SON SITE OU DE SON PRODUIT : le logo s'affiche EN GRAND, plein cadre dans la zone sure. C'est le moment le plus important de la video pour la marque, il ne reste jamais nu. Une seule fois dans la video, au premier passage. « mon site », « ma marque », « chez nous », « notre plateforme »." },
  { name: 'tools',   desc: "LES OUTILS EUX-MEMES, cote a cote : « les bons outils », « ma stack », « avec X et Y ». Les logos apparaissent l'un apres l'autre — pas un interrupteur, pas une ampoule : les vrais outils." },
  { name: 'copy',    desc: "UNE CLE / UN CODE QU'ON COPIE ET QU'ON EMPORTE AILLEURS : la cle apparait, « Copie » claque, et elle s'envole vers l'autre outil. « tu copies cette cle », « copie ce lien », « tu recuperes ton token ». C'est la TRANSITION entre deux applications." },
  { name: 'connect', desc: "DEUX OUTILS QUI SE BRANCHENT L'UN A L'AUTRE : les deux logos, la prise qui s'enclenche, le voyant qui passe au vert. « X est connecte a Y », « c'est relie », « ils communiquent entre eux », « l'integration est faite ». Choisis-la quand la LIAISON est le sujet — « tools » ne fait que les poser cote a cote." },
  { name: 'sign',    desc: "UN CONTRAT QUI SE SIGNE : le document, la signature qui se trace, le tampon SIGNE. « ils signent », « un contrat », « un deal », « ils te paient »." },
  { name: 'post',    desc: "PUBLIER SUR LES PLATEFORMES : les tuiles des reseaux et la video qui s'envole vers elles. « poster sur les reseaux », « publier partout », « en un clic sur tous tes comptes »." },
  { name: 'upload',  desc: "une carte qui s'envole : mettre en ligne, envoyer un fichier, deposer. « importe ton fichier », « televerse », « depose ton audio », « envoie ta video », « charge ton image »." },

  // ── l'argent ──

  // ── la croissance, l'audience ──
  { name: 'engage',  desc: "DES COEURS ET DES MESSAGES QUI MONTENT sur un fil de discussion. RESERVE au relationnel : « il te repond », « les messages », « ton match », « les DM », « ils t'ecrivent ». Pas pour de l'engagement chiffre — pour ca, prends countup ou grow." },
  { name: 'daypart', desc: "une journee ou seul un petit creneau de deux heures est colore : « une a deux heures par jour », « peu de temps », « quelques heures »." },
  { name: 'blankfill', desc: "une page blanche qui se remplit de resultats : partir de rien, « zero competence », « tu pars de zero », « aucune experience »." },
  { name: 'easyup', desc: "une courbe verte qui monte doucement, sans a-coup : la facilite, « c'est simple », « facile pour un debutant », « sans difficulte », « ca monte tout seul ». Axes gradues, aire verte, un point qui grimpe le long du trace." },
  { name: 'easydown', desc: "une courbe ROUGE qui descend doucement : ce qui baisse, s'effondre ou coute de moins en moins. « ca chute », « ca baisse », « de moins en moins cher », « les couts s'ecroulent », « ca degringole ». Axes gradues, aire rouge, un point qui glisse vers le bas." },
  { name: 'lowcost', desc: "peu d'argent a mettre au depart, un cout qui baisse, un investissement faible. « peu d'investissement », « ca coute presque rien », « sans mise de depart »." },
  { name: 'network', desc: "un reseau, une connexion, une communaute, des gens relies. « ta communaute », « ton audience », « les gens », « ton reseau », « tes abonnes »." },
  { name: 'rocket',  desc: "un lancement, un decollage, ce qui explose, devenir viral. « ca decolle », « le lancement », « ca explose », « ca part en fleche », « je lance »." },
  { name: 'funnel',  desc: "un entonnoir : beaucoup entrent, peu ressortent. « le tunnel », « peu ressortent », « le taux de conversion », « sur cent personnes », « il en reste »." },

  // ── la logique, la methode ──
  { name: 'idea',    desc: "une idee, une astuce, une methode, un declic, « le secret c'est... »." },
  { name: 'flow',    desc: "A MENE A B MENE A C : une chaine d'etapes reliees par des fleches. Mets les libelles dans items[].text (3 max, 14 caracteres). Ideal pour « tu fais X, ca te donne Y, et Y te rapporte Z »." },
  { name: 'orbit',   desc: "un centre et des satellites : tout part d'un seul outil. « tout part de la », « un seul outil », « le centre », « autour de »." },
  { name: 'list',    desc: "une liste, une bibliotheque, un catalogue, « plus de X scripts / modeles / options »." },
  { name: 'search',  desc: "chercher, analyser, trouver, reperer. « je cherche », « analyse », « trouve », « repere », « regarde ce qui marche », « la recherche »." },

  // ── l'opposition, le changement d'etat ──
  // ── PAQUET 1 (#157) — la qualité, le temps, la diffusion ──
  { name: 'quality', desc: "LA MEME IMAGE FLOUE PUIS NETTE, une ligne qui balaie, et LA MENTION DE QUALITE qui se pose sur la moitie nette. « la meilleure qualite », « c'est net », « en 4K ». Mets la mention entendue dans items[0].text (« 4K », « 1080p », « HD ») — sinon 4K par defaut." },
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
  { name: 'plan',    desc: "TROIS CARTES DE PRIX, celle du milieu ressort. « il y a trois formules », « l'offre du milieu », « choisis ton plan »." },
  { name: 'layers',  desc: "DES CALQUES qui se posent les uns sur les autres. « on empile les couches », « le montage », « on ajoute par-dessus »." },
  { name: 'trend',   desc: "UNE COURBE QUI GRIMPE avec une grande fleche qui suit sa pente, et le produit de la personne pose au sommet. « ca monte », « la tendance », « de mieux en mieux ». Mets ce qui monte dans items[0].text (« +240 % »)." },
  { name: 'record',  desc: "LE BOUTON D'ENREGISTREMENT qui pulse au-dessus d'une onde vivante. « tu enregistres ta voix », « appuie sur rec », « ta prise de son »." },

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
  { name: 'bgswap', desc: "LE DECOR QUI SE REMPLACE DERRIERE LA PERSONNE, la personne ne bouge pas. « tu changes le fond », « un autre decor », « le detourage »." },
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
  { name: 'profile', desc: "UN PROFIL SOCIAL : photo, compteur d'abonnes qui grimpe, grille de posts. « ton compte », « tes abonnes », « ta page ». Mets le nombre d'abonnes entendu dans items[0].text (« +12K »)." },
  { name: 'invoice', desc: "UNE FACTURE dont les lignes s'inscrivent et le total tombe. « la facture », « ce que ca coute », « le devis ». Mets le total entendu dans items[0].text." },
  { name: 'settings', desc: "UN PANNEAU DE REGLAGES dont les interrupteurs basculent un par un. « tu regles », « les parametres », « tu actives ce que tu veux »." },
  { name: 'thumb',   desc: "UNE MINIATURE DE VIDEO avec sa duree, son titre et son compteur de vues. « la miniature », « cette video a fait X vues ». items[0].text = le nombre de vues, items[1].text = la duree." },
  { name: 'leaderboard', desc: "UN CLASSEMENT dont TA ligne remonte a la premiere place. « passer devant », « etre premier », « depasser les autres »." },
  { name: 'pay',     desc: "UN PAIEMENT QUI PASSE : le recapitulatif, la carte, le bouton, la coche verte. « ils paient », « le paiement passe », « tu encaisses ». Mets le montant entendu dans items[0].text." },
  { name: 'sales',   desc: "DES NOTIFICATIONS DE VENTE qui tombent avec leur montant. « les ventes tombent », « ca commande », « chaque jour des commandes ». items[0..2].text = les trois montants entendus." },
  { name: 'folder',  desc: "UN DOSSIER QUI S'OUVRE et laisse sortir ses documents en eventail. « tes fichiers », « tout est range la », « ton dossier »." },

  // ── PAQUET 5 (#157) — l'outil et la vente ──
  { name: 'booking', desc: "UN AGENDA DE LA SEMAINE dont UN creneau se reserve. « il prend rendez-vous », « ton agenda se remplit », « il reserve »." },
  { name: 'form',    desc: "UN FORMULAIRE dont les champs se remplissent, puis le bouton part. « ils remplissent le formulaire », « ils laissent leur mail »." },
  { name: 'donut',   desc: "UN ANNEAU decoupe en parts avec sa legende. « la repartition », « X pour cent de », « la moitie de mes clients »." },
  { name: 'map',     desc: "UNE CARTE ou les epingles tombent une a une. « partout dans le monde », « dans tous les pays », « des clients partout »." },
  { name: 'mixer',   desc: "UNE TABLE DE MIXAGE : les curseurs montent, les vu-metres bougent. « je regle le son », « le mixage », « les niveaux »." },
  { name: 'review',  desc: "UNE CARTE D'AVIS : photo, nom, cinq etoiles qui se remplissent, le temoignage. « leurs avis », « ils temoignent », « ce qu'ils en disent »." },
  { name: 'upgrade', desc: "UNE CARTE QUI PASSE EN PRO et debloque ses options une par une. « tu passes en Pro », « tu montes de plan », « la version superieure ». Mets le nom du plan entendu dans items[0].text (« PRO », « ELITE »)." },
  { name: 'storyboard', desc: "DES PLANS NUMEROTES qui se posent en sequence, avec leur legende. « plan par plan », « le scenario », « la structure de la video »." },
  { name: 'music',   desc: "DEUX PISTES : la voix, et la musique dont le volume passe DESSOUS. « la musique de fond », « je baisse la musique », « sous la voix »." },
  { name: 'bio',     desc: "UN PROFIL, LE LIEN EN BIO qu'on tape, et la page qui monte. « le lien en bio », « clique sur le lien », « c'est dans ma bio »." },

  // ── PAQUET 6 (#157) — la mecanique sociale : ce qui se passe AUTOUR du post ──
  { name: 'keyword', desc: "UNE ZONE DE COMMENTAIRE OU LE MOT-CLE S'ECRIT lettre par lettre, puis le message prive arrive en reponse. « commente le mot X », « ecris-moi X », « tape X en commentaire ». Mets LE MOT EXACT qu'il demande dans items[0].text — c'est lui qu'on voit se taper." },
  { name: 'automation', desc: "UN FLUX AUTOMATIQUE : le declencheur, la condition, les deux branches. « c'est automatique », « le systeme s'en occupe », « ca tourne tout seul »." },
  { name: 'carousel', desc: "UN CARROUSEL dont les slides defilent, les points suivent. « le carrousel », « slide par slide », « fais defiler »." },
  { name: 'poll',    desc: "UN SONDAGE dont les deux barres se remplissent avec leur pourcentage. « ils votent », « le sondage », « demande-leur leur avis »." },
  { name: 'story',   desc: "DES STORIES : les anneaux en haut, la barre qui se remplit. « en story », « tu postes en story », « les stories »." },
  { name: 'hashtag', desc: "UNE LISTE DE HASHTAGS avec leur nombre de publications. « les hashtags », « les bons mots-cles », « ce qui est cherche »." },
  { name: 'schedule', desc: "UN CALENDRIER dont les creneaux se remplissent de publications. « c'est programme », « tu planifies ta semaine », « tout est prevu »." },

  // ── PAQUET 7 (#157) — LES DOMAINES D'ACTIVITE ──
  // La banque ne parlait que creation de contenu. Ses utilisateurs vendent des
  // produits, tradent, editent des logiciels, louent des biens : un e-commercant
  // qui dit « mon panier moyen » n'avait rien a mettre a l'ecran.
  { name: 'product', desc: "E-COMMERCE — UNE FICHE PRODUIT : le visuel, le nom, le prix, le bouton d'ajout au panier. « mon produit », « cet article », « ce que je vends ». Mets le prix entendu dans items[0].text." },
  { name: 'cart',    desc: "E-COMMERCE — UN PANIER : les articles, les quantites, le total qui s'affiche. « le panier moyen », « ils ajoutent au panier », « la commande ». Mets le total entendu dans items[0].text." },
  { name: 'delivery', desc: "E-COMMERCE — UN SUIVI DE LIVRAISON : le colis avance, les etapes se cochent. « la livraison », « le colis part », « ils recoivent en 48 h »." },
  { name: 'sizes',   desc: "E-COMMERCE — LES DECLINAISONS : les tailles et les couleurs, celles qu'on choisit s'encadrent. « toutes les tailles », « plusieurs coloris »." },
  { name: 'candles', desc: "TRADING — DES BOUGIES JAPONAISES qui se dessinent une a une, vertes et rouges. « le graphique », « la bougie », « ca monte sur le chart »." },
  { name: 'order',   desc: "TRADING — PASSER UN ORDRE : achat ou vente, le prix, la quantite, valider. « je passe un ordre », « j'achete », « je prends position »." },
  { name: 'pnl',     desc: "TRADING — LA COURBE DE PERFORMANCE qui se trace avec son pourcentage. « le rendement », « la performance », « depuis le debut ». Mets le pourcentage entendu dans items[0].text (« +41 % »)." },
  { name: 'mrr',     desc: "SAAS — LE REVENU RECURRENT : le montant, et les mois qui montent en barres. « le MRR », « l'abonnement mensuel », « le revenu recurrent ». Mets le montant entendu dans items[0].text (« 3 200€ »)." },
  { name: 'churn',   desc: "SAAS — LA RETENTION qui fuit : les barres se vident, le pourcentage en rouge. « le churn », « ils se desabonnent », « on en perd ». Mets le pourcentage entendu dans items[0].text (« -22 % »)." },
  { name: 'onboarding', desc: "SAAS — L'ACTIVATION : les taches se cochent, le pourcentage monte. « l'onboarding », « la prise en main », « les premieres etapes ». Mets le pourcentage entendu dans items[0].text (« 90 % »)." },
  { name: 'integrations', desc: "SAAS — DES OUTILS QUI SE BRANCHENT sur un coeur central. « les integrations », « ca se connecte a tout », « compatible avec »." },
  { name: 'menu',    desc: "RESTAURATION — UNE CARTE : les plats, leurs prix, celui qu'on choisit. « la carte », « le menu », « ce plat-la », « les prix »." },

  // ── PAQUET 8 (#157) — la suite des domaines ──
  { name: 'weight',  desc: "SPORT — UNE COURBE QUI DESCEND avec le chiffre perdu. « j'ai perdu X kilos », « la courbe descend », « les resultats ». Mets le chiffre exact ENTENDU dans items[0].text (« -10 kg »)." },
  { name: 'quote',   desc: "AGENCE / ARTISAN — UN DEVIS : les lignes, le total, la signature qui se trace. « le devis », « ma prestation », « ils signent le devis ». Mets le total entendu dans items[0].text." },

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
  { name: 'script',  desc: "UN SCRIPT dont les lignes s'ecrivent et dont une phrase se surligne. « le script », « ce que tu vas dire », « j'ecris le texte ». Mets la duree entendue dans items[0].text (« 0:42 »)." },
  { name: 'clapper', desc: "UN CLAP DE CINEMA rempli qui claque. « moteur », « on tourne », « prise deux », « action »." },
  { name: 'retakes', desc: "TROIS PRISES NUMEROTEES, les ratees se barrent, la bonne s'encadre. « on la refait », « la bonne prise », « je garde celle-la »." },
  { name: 'zoompunch', desc: "LE CADRE QUI SE RESSERRE d'un coup sur un detail qui grossit. « regarde bien ca », « zoom la-dessus », « le detail qui compte »." },
  { name: 'speedramp', desc: "UNE TIMELINE avec sa zone ralentie et sa zone acceleree. « la tu ralentis », « en accelere », « le ralenti sur ce moment »." },
  { name: 'substyle', desc: "TROIS STYLES DE SOUS-TITRES cote a cote, celui qu'on retient s'encadre. « le style de sous-titres », « tu choisis la typo »." },
  { name: 'trendsound', desc: "UN SON TENDANCE : sa forme d'onde, sa courbe d'usage, son compteur. « le son du moment », « le son qui marche », « la tendance ». Mets le nombre de videos entendu dans items[0].text." },
  { name: 'algorithm', desc: "UNE VIDEO QUI SE PROPAGE dans une grille d'ecrans autour d'elle. « l'algo te pousse », « ca part tout seul », « il te met en avant »." },
  { name: 'cv',      desc: "RECRUTEMENT — DES CANDIDATURES, celle qu'on retient ressort avec sa coche. « les candidatures », « je recrute », « celui-la je le prends »." },
  { name: 'framing', desc: "TOURNAGE — LE CADRE QUI SE RESSERRE sur le sujet, la grille des tiers apparait. « bien te cadrer », « le cadrage », « recentre-toi »." },
  { name: 'focus',   desc: "TOURNAGE — L'IMAGE FLOUE QUI DEVIENT NETTE d'un coup. « fais la mise au point », « c'est flou », « une image nette »." },
  { name: 'lighting', desc: "TOURNAGE — LA LUMIERE QUI SE POSE sur le visage, l'ombre recule. « eclaire-toi », « la lumiere », « ne tourne pas dans le noir »." },
  { name: 'caption', desc: "PUBLICATION — LA DESCRIPTION ET LES HASHTAGS QUI S'ECRIVENT sous la video avant de poster. « la description », « les hashtags », « ce que tu ecris »." },
  { name: 'spike',   desc: "ANALYSE — LA COURBE PLATE QUI DECOLLE D'UN COUP avec son chiffre. « ca a explose », « le pic », « d'un coup ». Mets le chiffre entendu dans items[0].text (« 340K »)." },
  { name: 'brandeal', desc: "CREATEUR — UNE MARQUE QUI PROPOSE UN PARTENARIAT, le montant arrive dans le message. « une marque m'a contacte », « un partenariat », « ils me paient ». Mets le montant entendu dans items[0].text (« 1500 € »)." },
  { name: 'mediakit', desc: "CREATEUR — LA FICHE STATS QUI SE COMPOSE, trois chiffres qui se posent. « mon media-kit », « mes stats », « ce que j'envoie aux marques ». Mets les trois valeurs entendues dans items[0..2].text (« 84K ; 2,1 M ; 7,4 % »)." },
  { name: 'stoploss', desc: "TRADING — LA BOUGIE QUI TOUCHE LA LIGNE et la position qui se ferme. « mon stop », « je coupe la perte », « ca part contre moi »." },
  { name: 'orderbook', desc: "TRADING — LE CARNET D'ORDRES QUI SE REMPLIT des deux cotes, l'ecart se resserre. « le carnet », « acheteurs et vendeurs », « le spread »." },
  { name: 'uptime',  desc: "SAAS — LA LIGNE DE DISPONIBILITE qui se remplit jour apres jour. « jamais de panne », « la dispo », « ca tourne tout le temps ». Mets le taux entendu dans items[0].text (« 99,98 % »)." },
  { name: 'leads',   desc: "SAAS — LES PROSPECTS QUI TOMBENT UN A UN dans la liste, le compteur monte. « les leads », « les inscrits », « ma liste grossit ». Mets le nombre entendu dans items[0].text (« 312 »)." },
  { name: 'comment', desc: "LE CLAVIER DU TELEPHONE et le mot qui se TAPE touche par touche dans le champ de commentaire. « ecris-moi en commentaire », « tape ce mot », « dis-le moi en commentaire ». Mets LE MOT a taper dans items[0].text — les touches s'enfoncent en meme temps que les lettres." },
  { name: 'share',   desc: "CTA UNIQUEMENT — LA BARRE D'ACTIONS D'UN POST : le coeur se remplit et pulse, la fleche de partage s'envole. « mets un like », « partage a quelqu'un », « enregistre ». Ne la choisis JAMAIS ailleurs que sur l'appel a l'action de fin. Mets le libelle entendu dans items[1].text (« PARTAGE », « LIKE »)." },
  { name: 'views',   desc: "LA VIGNETTE DE SA VIDEO et le COMPTEUR DE VUES qui grimpe dessous pendant que la lecture avance. « des millions de vues », « ca fait X vues », « les vues montent ». Mets le nombre entendu dans items[0].text (« 1 200 000 »)." },
  { name: 'linkbio', desc: "LE PROFIL ET LE LIEN DE LA BIO, avec un doigt qui vient appuyer dessus. « le lien dans ma bio », « clique sur le lien en bio », « tu as juste a mettre un lien dans ta bio ». Mets le libelle du lien dans items[0].text et le pseudo dans items[1].text." },

  // ── PAQUET 12 (#147) — LES QUATRE SCENES DECRITES PAR AXEL ──
  // Meme methode que `twopaths` et les quatre du 30/07 : il decrit la scene, on
  // fait la maquette, il valide, on integre. C'est la seule qui ait marche.
  // `brickbuild` (la main qui pose une brique, l'immeuble qui monte) a ete
  // ecarte a la maquette : la construction dit EFFORT alors que la phrase dit
  // FACILE. Remplace par `oneclick`, ou le geste EST le propos.
  { name: 'salesphone', desc: "UN TELEPHONE QUI SE MET A SONNER DE VENTES : les notifications de commande tombent l'une apres l'autre, de plus en plus vite, jusqu'a quatre, avec leur montant, et le compteur rouge grimpe avec elles. « ca peut changer ta vie », « ca rapporte », « les commandes tombent », « ca vend pendant que tu dors ». items[0..3].text = les montants entendus." },
  { name: 'oneclick', desc: "UN ORDINATEUR QU'ON OUVRE, UN SEUL CLIC, ET LE PROJET EST DEJA TERMINE : l'ecran se releve, le curseur clique une fois, le rendu fini s'affiche avec sa coche. « accessible aux debutants », « un seul clic », « c'est fait tout seul », « aucune competence », « meme si tu n'y connais rien »." },
  { name: 'tsunami', desc: "UNE PETITE ONDULATION QUI ENFLE JUSQU'A UN MUR D'EAU peuple de points de donnees : la meme vague en trois passages, de plus en plus haute. Rien n'est detruit. « la vraie vague arrive », « c'est un raz-de-maree », « ce qui arrive va tout emporter », « on n'a rien vu encore »." },
  { name: 'gaugefill', desc: "UNE JAUGE GRADUEE QUI MONTE DE 0 A 100 % pendant que les ventes tombent a cote, de plus en plus nombreuses (quatre au maximum). « 100 % des benefices », « tout est pour toi », « l'integralite », « tu gardes tout ». items[0].text = le pourcentage entendu, items[1..4].text = les montants." },
  { name: 'lineup', desc: "UN PRESENTOIR QUI SE REMPLIT AU FIL DE L'ENUMERATION : une etagere vide, et un VISUEL qui se pose a chaque terme prononce, choisi d'apres le terme — colis (produit), personne qui parle (coaching), cours qui se joue (formation), calque qui glisse (animations), haut-parleur (sons/bruitages), panneaux qui permutent (transitions) — SANS jamais ecrire les mots (le sous-titre les porte deja). Toute liste de 2 a 4 choses enumerees. items[k].text = le terme k, items[k].t = l'instant ou il est prononce (obligatoire)." },
]

export const ANIM_NAMES = BANK.map((b) => b.name)

// le bloc que lit le modèle, régénéré dans l'orchestrateur par sync-anim-bank.mjs
export const bankPrompt = () =>
  BANK.map((b) => `    ${b.name.padEnd(9)}— ${b.desc}`).join('\n')
