// Extrait les textes d'interface EN FRANÇAIS de app/index.html (traduction de l'app anglaise /en/app/) :
//   · texte du balisage et attributs lus (placeholder, title, aria-label, alt, data-tip) ;
//   · chaînes JS : fragments HTML nettoyés (balises entières ou coupées retirées), gabarits `…${x}…` et concaténations
//     'a' + x + 'b' → MODÈLES « a {} b » (le traducteur les reconnaît dans le texte affiché).
// Sortie JSON : { exact: [textes], modeles: [modèles] }, clés normalisées comme le traducteur (espaces ramenés à une).
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync(process.argv[2], 'utf8');
const exact = new Map(), modeles = new Map();
const norm = (s) => s.replace(/[\s   ]+/g, ' ').trim();
const ent = (s) => s.replace(/&nbsp;|&#160;|&#8239;|&#x202f;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;|&#x27;/g, "'").replace(/&rsquo;/g, '’').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&hellip;/g, '…').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&middot;/g, '·').replace(/&euro;/g, '€').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const ACC = /[àâçéèêëîïôûùüÿœÀÂÇÉÈÊËÎÏÔÛÙÜŒ]/;
const MOTS = /\b(le|la|les|des|du|et|pour|avec|ton|tes|ta|tu|toi|une|est|sur|dans|sans|qui|que|pas|ce|cette|ces|mon|ma|mes|aux|au|ou|il|elle|nous|vous|votre|vos|par|mais|tout|tous|plus|moins|ici|encore|leur|son|sa|ses|ne|se|sont|fait|faire)\b/i;
const SEULS = /^(annuler|fermer|retour|suivant|valider|continuer|chargement|compte|connexion|abonnement|enregistrer|supprimer|modifier|ajouter|importer|choisir|envoyer|appliquer|terminer|copier|copié|coller|rechercher|voir|masquer|afficher|aucun|aucune|oui|non|nouveau|nouvelle|gratuit|mensuel|annuel|bientôt|aperçu|réglages|paramètres|options|style|styles|texte|fond|couleur|taille|position|durée|vitesse|format|qualité|musique|voix|sous-titres|transcription|avancé|automatique|manuel|lien|liens|nom|prénom|langue|thème|sombre|clair|crédit|crédits|vidéo|vidéos|générer|générateur|bibliothèque|montage|éditeur|décupleur|marque|aide|tarifs|déconnexion|parrainage|historique|suggestions|personnage|avatar|avatars|produit|produits|images|photo|photos|projet|projets|brouillon|favoris|tout|rien|début|fin|haut|bas|centre|gauche|droite|aléatoire|outils|studio|plus|ou|et|envoyer|ouvrir|rendu|choisir|viens|suivis|boutique|connecter)$/i;
// mots français courants SANS accent (« Parcourir », « Fichier audio », « Continuer → ») : sans eux le filtre ratait ces textes
const LEXIQUE = new Set(('fichier parcourir changer utiliser comme recadrer supprimer sauvegarder largeur nettoyage synchroniser optionnel inclus ajouter '
  + 'depuis retirer inverser couleur autres verticale horizontale appliquer musique manuellement rognage rogner continuer accueil profil suivre partager '
  + 'abonner commentaires commenter finalisation astuce statut composition cours toutes connexions publier titre copier ouvrir programme parrainage gagne '
  + 'filleuls inscrits payants disponible disponibles demander virement inscrivent simulateur revenus envoyer autre chose correction visuel visuels rapides '
  + 'nombre moteur compris enregistreur vocal remplacer remplacement actif active automatique automatiques traitement naturel chaleureux nerveux rythme '
  + 'coupe manuelle comparer nettoyer rapide transformation nouvelle nouveau nouvel libre initialisation produit perso fille garcon quand maintenant '
  + 'programmer demain lire refaire avant effets texte sonores bruitages calques exporter autorise adresse authentification toujours requis clique puis '
  + 'commencer seul avis retour mot passe conditions configuration enregistrer actuelle apparence annuler abonnement compte solde actuel passer paiement '
  + 'acheter annulation partir raison finalement reste merci nomme cet choisir mensuel populaire tous femmes hommes synchronisation espace recommencer '
  + 'utilisation montant argent formation zoomer ajouts variantes paysage mascotte voix accroche essai ruban suppr biblio abonn vous fermer retour '
  + 'suivant valider chargement connexion modifier importer terminer coller rechercher voir masquer afficher aucun aucune oui non gratuit annuel bientot '
  + 'apercu reglages parametres options fond taille position vitesse format avance manuel lien liens nom prenom langue theme sombre clair aide tarifs '
  + 'deconnexion historique suggestions personnage avatars produits photos projet projets brouillon favoris tout rien haut bas centre gauche droite '
  + 'aleatoire outils plus ou et envoyer rendu viens suivis boutique connecter lipsync preset presets gameplay clip clips couper coupure piste pistes '
  + 'lecture pause arreter enregistrement micro sortie entree reussi echoue erreur attente patiente patienter telecharger telechargement minutes secondes '
  + 'jours semaine mois annee heure heures jamais encore deja seulement environ partout ensemble encore toujours simple facile gratuitement offert '
  + 'source remixer vous aime commenter publication titre naturel comparer lire suppr retirer suivre ajouts espace sauvegarder hommes calques astuce').split(' '));
function lexique(t) { return t.toLowerCase().split(/[^a-zàâçéèêëîïôûùüÿœ]+/).some((w) => w.length > 1 && LEXIQUE.has(w)); }
function francais(t) {
  if (ACC.test(t)) return true;
  if (/\bIA\b/.test(t)) return true;
  if (lexique(t) && (t.match(/\b(the|and|with|your|you|this|that|of|to|is|are|in|on|for|from|never|must|keep|same|it|be|by|or|an|as|at)\b/gi) || []).length < 2) return true;                                              // « Images IA », « Montage IA »
  // anglais = au moins 2 mots outils anglais (« On a quelque chose pour toi » est français malgré « On »)
  if (MOTS.test(t) && (t.match(/\b(the|and|with|your|you|this|that|of|to|is|are|in|on|for|from|never|must|keep|same)\b/gi) || []).length < 2) return true;
  return SEULS.test(t);
}
function nettoie(s) {
  s = ent(s);
  if (/>/.test(s) && !/</.test(s.slice(0, s.indexOf('>')))) s = s.slice(s.indexOf('>') + 1);   // fin de balise coupée
  if (/<[^>]*$/.test(s)) s = s.replace(/<[^>]*$/, '');                                          // début de balise coupée
  return s;
}
function bon(t) {
  if (t.length < 2 || t.length > 400 || !/[A-Za-zÀ-ÿ]/.test(t)) return false;
  if (/^[a-z0-9_.$-]+$/i.test(t) && !ACC.test(t) && !SEULS.test(t) && !LEXIQUE.has(t.toLowerCase())) return false;  // identifiant
  if (/^(https?:|\/|#|\.[\w/]|data:|image\/|video\/|audio\/)/.test(t)) return false;   // « . Le monteur… » (fin de phrase après <b>) reste du texte
  if (/[{};=]/.test(t) && /\b(function|const|let|var|return|=>)\b/.test(t)) return false;
  if (/[:;]\s*[a-z-]+\s*:/.test(t) && /px|rgba|var\(--/.test(t)) return false;     // CSS
  return francais(t);
}
function addExact(t) { t = norm(t); if (bon(t)) exact.set(t, (exact.get(t) || 0) + 1); }
function addTexte(s) {
  // texte qui peut contenir du HTML entier : chaque nœud de texte compte à part
  s = nettoie(s);
  for (const m of s.matchAll(/\b(placeholder|title|aria-label|alt|data-tip|data-tooltip|label)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) addExact(m[2] != null ? m[2] : m[3]);   // l'apostrophe d'un texte entre "…" ne coupe plus
  for (const part of s.replace(/<!--[\s\S]*?-->/g, '').split(/<[^>]*>/)) addExact(part);
}
function addModele(parts) {
  // parts : morceaux de texte entre les trous (au moins un trou) → « a {} b » si du français entoure le trou
  const t = norm(parts.map((p) => nettoie(p).split(/<[^>]*>/).join(' ')).join(' {} ').replace(/(\{\}\s*)+/g, '{} '));
  if (!/\{\}/.test(t) || /[<>]/.test(t)) return;
  const sans = t.replace(/\{\}/g, '').trim();
  if (sans.length < 3 || !bon(sans)) return;
  if (/^\{\}$|^[^A-Za-zÀ-ÿ]*\{\}[^A-Za-zÀ-ÿ]*$/.test(t)) return;
  modeles.set(t, (modeles.get(t) || 0) + 1);
}
// 1) balisage hors <script>/<style>
addTexte(src.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' '));
// 2) chaînes des scripts (+ concaténations)
for (const sm of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  const code = sm[1], n = code.length;
  let i = 0, chaine = null;   // chaîne en cours : [morceaux] ; null = aucune
  const fin = () => { if (chaine) { if (chaine.length > 1) addModele(chaine); chaine = null; } };
  const lit = (q) => {        // lit un littéral à partir de i (q = guillemet) → { texte avec \u0001 pour ${}, suite }
    let j = i + 1, s = '';
    while (j < n && code[j] !== q) {
      if (code[j] === '\\') { s += code[j + 1] === 'n' ? '\n' : code[j + 1]; j += 2; continue; }
      if (q === '`' && code.startsWith('${', j)) { let d = 1; j += 2; s += '\u0001'; while (j < n && d) { if (code[j] === '{') d++; else if (code[j] === '}') d--; j++; } continue; }
      if (q !== '`' && code[j] === '\n') break;
      s += code[j]; j++;
    }
    return { s, j: j + 1 };
  };
  while (i < n) {
    const c = code[i];
    if (code.startsWith('//', i)) { const j = code.indexOf('\n', i); i = j < 0 ? n : j; continue; }
    if (code.startsWith('/*', i)) { const j = code.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const { s, j } = lit(c); i = j;
      const parts = s.split('\u0001');
      if (parts.length > 1) addModele(parts);
      for (const p of parts) addTexte(p);
      // concaténation : littéral + expr + littéral (même expression, sans ; ni retour de ligne au milieu)
      const apres = code.slice(i, i + 160);
      const m = apres.match(/^\s*\+\s*([^'"`;\n]{1,100}?)\s*\+\s*(['"])/);
      if (m && !/[{}]/.test(m[1])) {
        if (!chaine) chaine = [s.split('\u0001').pop()];
        chaine.push(null);   // trou
        i += m[0].length - 1;  // se place sur le guillemet suivant
        const r = lit(code[i]); i = r.j; chaine[chaine.length - 1] = undefined; chaine.push(r.s.split('\u0001')[0]); addTexte(r.s);
        // on enchaîne tant que le motif continue
        let k;
        while ((k = code.slice(i, i + 160).match(/^\s*\+\s*([^'"`;\n]{1,100}?)\s*\+\s*(['"])/)) && !/[{}]/.test(k[1])) {
          i += k[0].length - 1; const r2 = lit(code[i]); i = r2.j; chaine.push(undefined); chaine.push(r2.s.split('\u0001')[0]); addTexte(r2.s);
        }
        const parts2 = chaine.filter((x) => x !== undefined && x !== null);
        addModele(parts2.length > 1 ? parts2 : [parts2[0] || '', '']);
        chaine = null;
      }
      continue;
    }
    if (c === '/') {
      let k = i - 1; while (k >= 0 && /\s/.test(code[k])) k--;
      if (k < 0 || '(,=:[!&|?{};+-*%<>~^'.includes(code[k]) || code.slice(k - 5, k + 1) === 'return') {
        let j = i + 1, cls = false;
        while (j < n && code[j] !== '\n') { if (code[j] === '\\') { j += 2; continue; } if (code[j] === '[') cls = true; else if (code[j] === ']') cls = false; else if (code[j] === '/' && !cls) break; j++; }
        i = j + 1; continue;
      }
    }
    i++;
  }
  fin();
}
const E = [...exact.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
const M = [...modeles.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).filter((t) => !exact.has(t));
writeFileSync(process.argv[3], JSON.stringify({ exact: E, modeles: M }, null, 1));
console.log(E.length, 'textes,', M.length, 'modèles ;', E.join('').length + M.join('').length, 'caractères');
