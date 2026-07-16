# Photo de profil des e-mails AvatarAds (BIMI)

Le logo qui s'affiche à la place du « A » rouge générique dans les boîtes mail
est géré par **BIMI** (Brand Indicators for Message Identification). BIMI se
pose PAR-DESSUS SPF + DKIM + DMARC : ces 3 doivent déjà passer (Resend gère
SPF/DKIM). Il faut ensuite un **DMARC en mode strict** + un **enregistrement
BIMI** qui pointe vers le SVG.

## 1. Le logo (déjà fait ✅)

- Fichier : `assets/bimi/avatarads-bimi.svg` (profil SVG Tiny 1.2 « tiny-ps »,
  carré, `<title>`, fond plein, 733 octets — conforme BIMI).
- URL une fois déployé : **https://avatarads.fr/assets/bimi/avatarads-bimi.svg**
  (doit être servi en HTTPS, accessible publiquement — GitHub Pages le fait).

## 2. DNS à ajouter (chez le registrar du domaine avatarads.fr)

### a) DMARC — OBLIGATOIRE et doit être « enforcing »
BIMI ne marche QUE si DMARC est en `p=quarantine` (à 100 %) ou `p=reject`.
Si le DMARC actuel est `p=none`, il faut le passer en quarantine.

| Champ | Valeur |
|-------|--------|
| Type  | `TXT` |
| Nom / Host | `_dmarc` (→ `_dmarc.avatarads.fr`) |
| Valeur | `v=DMARC1; p=quarantine; rua=mailto:dmarc@avatarads.fr; adkim=s; aspf=s` |

> ⚠️ Ne pas mettre `pct=` inférieur à 100. Avant de passer en quarantine,
> vérifie pendant quelques jours que Resend passe bien DMARC (rapports `rua`),
> sinon des vrais e-mails pourraient partir en spam.

### b) BIMI — l'enregistrement du logo
| Champ | Valeur |
|-------|--------|
| Type  | `TXT` |
| Nom / Host | `default._bimi` (→ `default._bimi.avatarads.fr`) |
| Valeur | `v=BIMI1; l=https://avatarads.fr/assets/bimi/avatarads-bimi.svg; a=` |

`l=` = lien du SVG. `a=` = certificat (voir §3). Sans certificat on le laisse vide.

## 3. Le certificat VMC / CMC — l'étape payante (à ta charge)

C'est le point important : **Gmail et Apple Mail** (la majorité des destinataires)
n'affichent PAS le logo BIMI sans un **certificat** attestant que le logo est
bien à toi :
- **VMC** (Verified Mark Certificate) : nécessite une **marque déposée** (INPI /
  EUIPO) du logo. ~1 000–1 500 $/an (DigiCert, Entrust).
- **CMC** (Common Mark Certificate) : pas besoin de marque déposée mais logo en
  usage public depuis 12 mois. Aussi payant (~1 000 $/an). Accepté par Gmail.

Une fois le certificat obtenu, on héberge le `.pem` et on complète `a=` :
`v=BIMI1; l=https://avatarads.fr/assets/bimi/avatarads-bimi.svg; a=https://avatarads.fr/assets/bimi/avatarads-vmc.pem`

### Sans certificat (gratuit, tout de suite)
- Certains clients affichent déjà le logo BIMI sans VMC (Fastmail, La Poste, une
  partie de Yahoo). Gmail/Apple : non.
- **Gravatar** (gratuit) : créer un Gravatar sur l'adresse d'envoi
  (ex. `no-reply@avatarads.fr`) affiche le logo dans quelques webmails — mais
  PAS Gmail. Petit gain, zéro coût.

## 4. Vérifier
- SVG conforme : https://bimigroup.org/bimi-generator/ (onglet « SVG validator »).
- Enregistrement complet : https://bimigroup.org/bimi-inspector/ ou
  `dig TXT default._bimi.avatarads.fr` et `dig TXT _dmarc.avatarads.fr`.

## Résumé décision
1. Ajouter les 2 enregistrements DNS ci-dessus (gratuit) → logo prêt côté technique.
2. Pour l'affichage Gmail/Apple : acheter un VMC/CMC (payant) — décision business.
