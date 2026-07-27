# Récolter les captures de l'app et leurs zones — au pixel près

## Pourquoi pas la détection visuelle

On a essayé deux fois de faire cadrer les zones par un modèle de vision, sur les
captures qu'Axel envoie :

| tentative | résultat |
|---|---|
| coordonnées demandées dans le repère recadré | dérive verticale sur tout le bas |
| coordonnées sur l'image d'origine + conversion serveur | ~2 zones sur 3 dans le bon voisinage |
| collage des cadres aux vrais bords par analyse de contraste | **33 sur 236** |

Axel : « mal encadré, faut vraiment encadrer au pixel près ». Il a raison, et la
raison est structurelle : sur une interface sombre où les boutons sont sombres
eux aussi, il n'y a pas assez de contraste pour retrouver un bord. Un modèle de
vision sait très bien **nommer** un élément ; il ne sait pas le **mesurer**.

## Ce qui marche : lire le DOM

L'app est la nôtre. `getBoundingClientRect()` donne la position RÉELLE de chaque
bouton — pas une estimation. Et comme on prend la capture dans la même page, au
même instant, **l'image et les coordonnées ne peuvent pas diverger**.

Bénéfice inattendu : ça règle #145 (les captures tuto périmées). Elles ne sont
plus des fichiers qu'on refait à la main quand l'interface change, elles se
régénèrent.

## Mode d'emploi

Servir le dépôt puis, dans la console de la page :

```js
// 1 · entrer dans l'app sans passer par l'OTP
enterApp({ id:'…', email:'…', plan:'elite', credits_remaining:2200, first_name:'axel' })

// 2 · installer le récolteur
window.__harvest = (view) => { /* cf. plus bas */ }

// 3 · pour chaque écran : naviguer, récolter, capturer
nav('express'); __harvest('express')
openMcpModal(); __harvest('connecter-claude')
```

Le récolteur renvoie, pour chaque élément cliquable VISIBLE :

```
{ name: 'generer-ma-cle', label: 'Générer ma clé',
  x: 0.3273, y: 0.3837, w: 0.1377, h: 0.0452 }
```

`name` vient du libellé (slug) : c'est lui que le chef d'orchestre choisira en
entendant « tu cliques sur générer la clé ». `x/y` sont le CENTRE, normalisés
sur la fenêtre — le format exact qu'attend `screen-spots.mjs`.

### Le récolteur

```js
window.__harvest = (viewName) => {
  const W = innerWidth, H = innerHeight
  const slug = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)
  const sel = 'button,a[href],input,select,textarea,[onclick],[role="button"],[role="tab"]'
  const out = [], seen = new Set()
  for (const el of document.querySelectorAll(sel)) {
    if (!el.offsetParent) continue                     // invisible : on ignore
    const r = el.getBoundingClientRect()
    if (r.width < 12 || r.height < 12) continue        // trop petit pour être visé
    if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue  // hors cadre
    const label = (el.getAttribute('aria-label') || el.value || el.placeholder || el.textContent || '')
      .replace(/\s+/g,' ').trim().slice(0,60)
    let name = slug(label) || slug(el.id) || slug(el.className.split(' ')[0])
    if (!name) continue
    let n = name, i = 2; while (seen.has(n)) n = name + '-' + (i++)
    seen.add(n)
    out.push({ name: n, label,
      x: +((r.left + r.width/2)/W).toFixed(4), y: +((r.top + r.height/2)/H).toFixed(4),
      w: +(r.width/W).toFixed(4), h: +(r.height/H).toFixed(4) })
  }
  return { view: viewName, W, H, zones: out }
}
```

## Ce que ça ne couvre pas

Les écrans qui ne sont PAS les nôtres — les Paramètres de Claude, dans le tuto
« connecter le MCP ». Pas de DOM accessible, donc mesure à la main sur la
capture : il n'y a que six zones qui comptent (Paramètres, Connecteurs, Ajouter,
connecteur personnalisé, champ nom, champ URL).

Pour un utilisateur qui dépose une capture d'une app tierce, c'est le même cas :
la détection propose, il corrige dans l'Éditeur. D'où #159.
