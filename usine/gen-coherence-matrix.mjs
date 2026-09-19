import { writeFileSync } from 'node:fs';
export const hooks = [
 ['12',"Cette influenceuse me permet de faire des millions de vues et pourtant elle n'existe pas. Et là, je vais t'apprendre à faire la même chose."],
 ['13',"Cette influenceuse me permet de faire des millions de vues et pourtant elle n'existe pas. Et là, je vais t'apprendre à faire la même chose."],
 ['14',"Laisse-moi 30 secondes pour te montrer comment créer un avatar IA avec cette qualité-là."],
 ['15',"Bon, on va être honnête, la plupart des vidéos IA sont fake, genre vraiment fake. Mais si tes vidéos ont l'air fake, aucune marque ne voudra bosser avec toi."],
 ['16',"Claude peut maintenant générer des vidéos depuis un seul prompt. Je t'explique comment faire à la fin de la vidéo."],
 ['17',"AvatarAds connecté à Claude, ça vient de sortir et c'est déjà une dinguerie. Tu peux maintenant créer une vidéo juste en tapant un prompt."],
 ['18',"C'est littéralement une dinguerie, AvatarAds connecté à Claude vient de sortir, tu peux maintenant créer n'importe quelle vidéo directement dans Claude."],
 ['19',"Ce que tu regardes là, c'est la dernière technologie en termes de vidéo IA en 2026."],
 ['20',"J'en suis pas fier mais j'ai les couilles de le dire, j'ai trouvé la façon la plus débile de faire 1000€ par jour."],
 ['21',"Personne ne te montre comment faire des influenceuses IA, mais moi je vais te montrer en 30 secondes top chrono."],
 ['23',"Personne ne te montre comment faire des vidéos IA comme ça, mais moi je vais te montrer en 20 secondes top chrono."],
 ['24',"Waouh, tu peux maintenant créer des vidéos dans Claude et je te montre en 30 secondes comment faire dans cette vidéo."],
 ['25',"Est-ce que c'est de la triche ? J'ai créé cette vidéo en deux clics."],
 ['26',"TikTok met de plus en plus en avant les vidéos dynamiques et je t'explique comment faire dans cette vidéo."],
 ['27',"Ok, la plupart des vidéos sont lentes et molles avec trop de blancs. Et c'est exactement pourquoi TikTok ne pousse pas ta vidéo."],
 ['28',"Et si je te disais que j'ai monté cette vidéo en seulement 30 secondes avec uniquement un audio comme base, tu me crois ?"],
 ['29',"Dans les 30 prochaines secondes, tu vas savoir comment créer des vidéos virales avec seulement un audio comme base."],
 ['30',"Dans les 30 prochaines secondes, tu sauras comment créer des vidéos virales 4K comme ça et attirer plus de clients sur ton site."],
 ['31',"Dans les 30 prochaines secondes, tu sauras comment créer des images 4K comme ça, puis les transformer en une vidéo virale."],
 ['32',"Je t'explique en 30 secondes comment je fais pour supprimer les silences de mes vidéos pour les rendre virales."],
 ['33',"Ok, donne-moi 30 secondes pour te montrer comment monter tes vidéos avec l'IA en moins d'une minute."],
 ['34',"Le travail de montage qui te prenait 3 heures avant ne te prendra que le temps d'un café grâce à cette méthode."],
 ['35',"Donne-moi 30 secondes pour te montrer pourquoi tes vidéos ne percent pas."],
 ['36',"TikTok pousse de ouf le contenu original de bonne qualité et dynamique. Et dans 30 secondes, tu sauras exactement comment faire ça."],
 ['40',"Si tu veux créer du contenu réaliste comme ça, utilise avatarads.fr, c'est clairement le seul site actuellement qui propose ce niveau de réalisme là."],
 ['48',"À tous les jeunes qui veulent réellement faire de l'argent et entreprendre, regarde jusqu'à la fin."],
 ['53',"Laisse-moi te montrer comment remplacer ton visage par n'importe quel personnage avec des mouvements parfaitement naturels et une cohérence visuelle impeccable, en moins de 30 secondes."],
 ['57',"Voici comment tu peux te transformer en n'importe qui en tenant n'importe quel objet."],
 ['58',"Voici comment reproduire des publicités gagnantes grâce à l'IA et les vendre aux entreprises pour générer des revenus."],
 ['60',"Des gens génèrent des milliers de dollars grâce à des avatars IA comme ceci, alors voici comment créer le tien en moins de 2 minutes."],
 ['63',"C'est clairement la façon la plus débile de faire 1000€ par jour, et je vais te montrer comment remplacer le visage et le corps d'une personne par celui de ton choix, en moins de 60 secondes."],
 ['64',"Je vais te montrer comment, depuis une vidéo, tu peux remplacer le visage et le corps d'une personne par celui de ton choix, en moins de 60 secondes."],
 ['67',"AvatarAds vient tuer After Effects et CapCut en même temps."],
 ['68',"Voici comment créer une publicité UGC en moins de 10 minutes sans jamais tourner aucune vidéo."],
 ['69',"Le pire truc que tu puisses faire, c'est de lancer un projet et que personne ne le voit. Voilà comment je m'assure que ça n'arrive jamais."],
 ['70',"Tu veux lancer un business en ligne mais tu ne sais pas comment être visible sur les réseaux ? J'ai exactement ce qu'il te faut."],
 ['72',"Le plus gros problème avec Claude, c'est qu'il ne peut pas générer de photos ou de vidéos dans le chat. Enfin, ça, c'était avant."],
 ['73',"Si tu veux créer ta marque, cette vidéo est pour toi. Je te montre comment créer depuis Claude un influenceur UGC hyper réaliste comme celui-là, en 30 secondes top chrono."],
 ['74',"Laisse-moi te montrer un outil interdit en Europe pour transformer n'importe quel objet en ce que tu veux."],
 ['74v2',"Tu peux comme ici transformer une Clio en Bugatti ou même transformer ta montre en montre de luxe. Les possibilités sont infinies."],
 ['75',"C'est vraiment la façon la plus débile de faire 10 000€ par mois depuis ton téléphone, même un enfant de 10 ans peut le faire."],
 ['76',"Je te montre comment créer depuis Claude des pubs pour ton produit hyper réaliste comme cela, en 30 secondes top chrono."],
 ['77',"Je te montre comment créer des pubs pour ton produit avec un gros taux de retour sur investissement comme cela, en 30 secondes top chrono."],
];
// Génériques : liste des ❌ (tout le reste = ✅). Spécifiques : liste des ✅.
const L12_ok = new Set(['12','13','14','21','60','73']);        // SPÉCIFIQUE influenceur/avatar
const L15_no = new Set(['25','26','27','28','32']);             // GÉNÉRIQUE réalisme
const L16_no = new Set(['15','19','28','48']);                  // GÉNÉRIQUE qualité (besoin d'un visuel/avatar)
const L19_no = new Set(['32']);                                // GÉNÉRIQUE évolution IA
const L28_ok = new Set(['20','25','26','27','28','29','30','33','34','35','36','48','67','68','69','70','75','76','77']); // NICHE montage + pub/argent/business
const L30_ok = new Set(['16','17','18','20','21','23','25','26','27','28','29','31','33','34','35','36','40','48','58','60','67','68','69','70','75','76','77']); // audio+avatar / démo-driven
const L32_ok = new Set(['12','13','14','15','16','17','18','19','20','21','23','24','27','28','29','30','31','32','33','34','35','36','40','48','60','63','67','68','69','70','73','75','76','77']); // algo TikTok / dynamisme
const L33_ok = new Set(['14','15','16','19','20','23','24','25','26','27','28','29','33','34','35','36','48','53','58','60','67','68','69','70','75']); // recette virale (= L35)
const L34_ok = new Set(['12','13','20','21','23','25','26','27','28','29','30','31','32','33','34','35','36','40','48','58','60','67','68','69','70','75','76']); // problème de vues
const L48_ok = new Set(['12','13','14','15','17','18','20','21','23','24','25','26','27','28','29','30','31','36','40','48','58','60','63','67','68','69','70','74','74v2','75','76','77']); // GÉNÉRIQUE visibilité=vente
const L58_ok = new Set(['16','17','18','20','24','40','48','58','60','68','69','72','73','75','76','77']); // NICHE produit physique
const L70_ok = new Set(['12','13','14','15','16','19','20','21','23','24','25','30','36','40','48','58','60','63','64','68','69','70','72','73','75','76','77']); // GÉNÉRIQUE sans montrer ton visage
// L69 ABANDONNÉE (trop niche) · L72 ABANDONNÉE
export const LIAISONS = [
  { id:'L12', ok:L12_ok }, { id:'L15', no:L15_no }, { id:'L16', no:L16_no }, { id:'L19', no:L19_no },
  { id:'L28', ok:L28_ok }, { id:'L30', ok:L30_ok }, { id:'L32', ok:L32_ok }, { id:'L33/L35', ok:L33_ok },
  { id:'L34', ok:L34_ok }, { id:'L48', ok:L48_ok }, { id:'L58', ok:L58_ok }, { id:'L70', ok:L70_ok },
];
export const compatLiaisons = (hid) => LIAISONS.filter(L => L.ok ? L.ok.has(hid) : !L.no.has(hid)).map(L=>L.id);
const cell = (id, kind, set) => (kind==='ok' ? set.has(id) : !set.has(id)) ? '✅' : '❌';
let md = `# Matrice de cohérence HOOK × LIAISON\n\n`;
md += `Généré depuis les validations d'Axel (volets successifs). ✅ = la liaison s'enchaîne après le hook.\n`;
md += `Génériques : L15, L16, L19, L48. Spécifiques / niche : L12, L28, L30, L32, L33/L35, L34.\n\n`;
md += `Chaque vidéo = 2 formats : \`hook+contenu+CTA\` (court) et \`hook+liaison+contenu+CTA\` (long).\n\n`;
md += `## Liaisons\n`;
md += `- **L12** SPÉCIFIQUE influenceur/avatar — « Il faut d'abord déterminer l'identité de ton influenceur IA… »\n`;
md += `- **L15** GÉNÉRIQUE réalisme — « Ceux qui signent des contrats… maîtrisent le réalisme… bons outils »\n`;
md += `- **L16** GÉNÉRIQUE qualité (besoin d'un visuel → coller un avatar) — « Regarde ça, meilleure qualité d'image et vidéo du marché »\n`;
md += `- **L19** GÉNÉRIQUE évolution IA — « Il y a quelques mois c'était impossible… l'IA évolue, opportunité »\n`;
md += `- **L28** NICHE montage + pub/argent/business (rognée) — « Tu n'as plus besoin de payer un monteur… »\n`;
md += `- **L30** audio+avatar (sélection pensée démo) — « Tu as juste besoin d'un audio qui parle de ton produit et d'un avatar »\n`;
md += `- **L32** NICHE algo TikTok / dynamisme — « En ce moment TikTok pousse à fond le contenu dynamique… les premiers prendront une avance »\n`;
md += `- **L33 / L35** NICHE recette virale — « Une bonne vidéo virale = un bon visuel, un son dynamique et un montage de qualité »\n`;
md += `- **L34** NICHE problème de vues — « Si tu bloques à 300-400 vues, tes vidéos ne sont pas assez dynamiques… »\n`;
md += `- **L48** GÉNÉRIQUE visibilité=vente — « Avoir de la visibilité en 2026 peut te faire vendre tout ce que tu veux… cause d'échec de 99% »\n`;
md += `- **L58** NICHE produit physique — « Tu peux utiliser l'IA pour intégrer ton produit dans n'importe quelle vidéo et en tirer profit… »\n`;
md += `- **L70** GÉNÉRIQUE sans montrer ton visage — « AvatarAds te permet de créer du contenu sur ton produit sans jamais montrer ton visage »\n`;
md += `- ~~**L69**~~ ABANDONNÉE (trop niche, brique supprimée) · ~~**L72**~~ ABANDONNÉE\n\n`;
md += `## Matrice\n\n`;
md += `| Hook | L12 | L15 | L16 | L19 | L28 | L30 | L32 | L33/L35 | L34 | L48 | L58 | L70 |\n|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|\n`;
for (const [id,txt] of hooks){
  md += `| **H${id}** · ${txt} | ${cell(id,'ok',L12_ok)} | ${cell(id,'no',L15_no)} | ${cell(id,'no',L16_no)} | ${cell(id,'no',L19_no)} | ${cell(id,'ok',L28_ok)} | ${cell(id,'ok',L30_ok)} | ${cell(id,'ok',L32_ok)} | ${cell(id,'ok',L33_ok)} | ${cell(id,'ok',L34_ok)} | ${cell(id,'ok',L48_ok)} | ${cell(id,'ok',L58_ok)} | ${cell(id,'ok',L70_ok)} |\n`;
}
// compte par liaison
const count = (kind,set)=>hooks.filter(([id])=> (kind==='ok'?set.has(id):!set.has(id))).length;
md += `\n**✅ par liaison** — L12 ${count('ok',L12_ok)} · L15 ${count('no',L15_no)} · L16 ${count('no',L16_no)} · L19 ${count('no',L19_no)} · L28 ${count('ok',L28_ok)} · L30 ${count('ok',L30_ok)} · L32 ${count('ok',L32_ok)} · L33/L35 ${count('ok',L33_ok)} · L34 ${count('ok',L34_ok)} · L48 ${count('ok',L48_ok)} · L58 ${count('ok',L58_ok)} · L70 ${count('ok',L70_ok)} (sur ${hooks.length} hooks)\n`;
md += `\n> **Analyse cohérence : 12 liaisons validées** (L33=L35 ; L69 & L72 abandonnées).\n`;
md += `> **Étape suivante** : ranger chaque hook dans une ou plusieurs FAMILLES (multi-famille possible) + analyse « pourquoi telle famille et pas telle autre » (générique ≠ 100% des hooks).\n`;
writeFileSync('usine/coherence-hook-liaison.md', md);
console.log('écrit usine/coherence-hook-liaison.md');
console.log('✅ counts: L12',count('ok',L12_ok),'L15',count('no',L15_no),'L16',count('no',L16_no),'L19',count('no',L19_no),'L28',count('ok',L28_ok),'L30',count('ok',L30_ok),'L32',count('ok',L32_ok),'L33/35',count('ok',L33_ok),'L34',count('ok',L34_ok),'L48',count('ok',L48_ok),'L58',count('ok',L58_ok),'L70',count('ok',L70_ok));
