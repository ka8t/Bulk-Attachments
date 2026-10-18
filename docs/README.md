# Bulk Attachments pour Gmail

Extension Chrome (Manifest V3) qui télécharge en masse les pièces jointes de vos e-mails Gmail, sur le modèle de « Save Bulk Gmail Attachments ».

## Fonctionnalités

- Recherche par expéditeur, destinataire, objet, libellé, période, extensions de fichier, taille minimale, ou n'importe quelle requête Gmail avancée.
- Reprise automatique de la recherche Gmail en cours : cliquez sur l'icône de l'extension depuis une page de recherche Gmail.
- Liste des pièces jointes avant téléchargement : cases à cocher, filtre texte, lien vers l'e-mail d'origine.
- Doublons (même nom et même taille, typiquement un fichier transféré plusieurs fois) repérés et décochés.
- Images intégrées (logos de signature) exclues par défaut.
- Téléchargement en archive ZIP (découpée au-delà d'une taille maximale) ou en fichiers séparés.
- Rangement dans des dossiers : par expéditeur, par mois, par jour, par type de fichier ou un dossier par e-mail.
- Nommage des fichiers : nom d'origine, préfixé par la date et/ou l'expéditeur. Les collisions de noms reçoivent un suffixe « (2) », « (3) »…
- Dans un ZIP, chaque fichier porte la date de l'e-mail comme date de modification.
- Index CSV (date, expéditeur, objet, fichier, chemin, statut, lien Gmail), lisible directement dans Excel.

## Fonctionnement et confidentialité

L'extension passe par l'API Gmail officielle avec le seul droit `gmail.readonly` (lecture seule) : elle ne peut ni envoyer, ni modifier, ni supprimer d'e-mail. Tout se passe dans votre navigateur. Aucune donnée ne transite par un serveur tiers : les seules connexions sont vers `gmail.googleapis.com` (lecture) et `oauth2.googleapis.com` (révocation du jeton à la déconnexion).

OAuth : protocole d'autorisation de Google. Vous accordez à l'extension un accès limité à votre compte sans lui donner votre mot de passe. Google demande que chaque application qui utilise l'API Gmail possède son propre « identifiant client OAuth », d'où l'étape de configuration ci-dessous, à faire une seule fois.

## Configuration actuelle (déjà faite)

| Élément | Valeur |
| --- | --- |
| Projet Google Cloud | `bulk-attachments` (« Bulk Attachments ») |
| API activée | Gmail API |
| Écran de consentement | Externe, statut « En test » |
| Utilisateur test | l'adresse Gmail du propriétaire du projet |
| Client OAuth | type « Extension Chrome », `377933113644-91aansd2k7q3tkpbicu7jugil6ml1i00.apps.googleusercontent.com` |
| ID de l'extension | `dbangjhmkaaijopbjedmcpjnnhndngfl` |

L'identifiant client est déjà renseigné dans `manifest.json`. Il reste seulement l'étape 3 (charger l'extension dans Chrome). Les étapes 1 et 2 servent à refaire la configuration sur un autre projet Google Cloud. Pour autoriser une autre adresse Gmail : console Google Cloud → projet `bulk-attachments` → Google Auth Platform → Audience → Utilisateurs test.

## Installation

### 1. Créer l'identifiant OAuth dans Google Cloud (une fois, environ 10 minutes)

1. Ouvrir <https://console.cloud.google.com/> et créer un projet (ex. « Bulk Attachments »).
2. Menu **API et services → Bibliothèque** : rechercher **Gmail API** puis cliquer sur **Activer**.
3. Menu **Google Auth Platform** (anciennement « Écran de consentement OAuth ») → **Commencer** :
   - Nom de l'application : `Bulk Attachments` ; adresse e-mail d'assistance : la vôtre.
   - Audience : **Externe** (ou **Interne** si vous avez un compte Google Workspace et que l'extension ne sert qu'à votre organisation).
   - Coordonnées : votre adresse e-mail. Valider.
4. **Audience → Utilisateurs test → Ajouter des utilisateurs** : ajouter l'adresse Gmail dont vous voulez télécharger les pièces jointes. Laisser l'application en statut « En test » : aucune validation de Google n'est nécessaire pour un usage personnel.
5. **Accès aux données → Ajouter ou supprimer des champs d'application** : cocher `.../auth/gmail.readonly`. Enregistrer.
6. **Clients → Créer un client** :
   - Type d'application : **Extension Chrome**.
   - ID de l'article : `dbangjhmkaaijopbjedmcpjnnhndngfl`
   - Créer, puis copier l'**ID client** (il se termine par `.apps.googleusercontent.com`).

L'ID d'extension `dbangjhmkaaijopbjedmcpjnnhndngfl` est figé par la clé publique `key` de `manifest.json` : il reste le même sur toutes les machines où vous chargez le dossier. Ne modifiez pas cette clé, sinon l'ID change et l'identifiant OAuth ne correspond plus.

### 2. Renseigner l'identifiant dans l'extension

Dans `manifest.json`, remplacer :

```json
"client_id": "REMPLACER_PAR_VOTRE_CLIENT_ID.apps.googleusercontent.com",
```

par l'ID client copié à l'étape précédente.

### 3. Charger l'extension dans Chrome

1. Ouvrir `chrome://extensions`.
2. Activer le **Mode développeur** (en haut à droite).
3. Cliquer sur **Charger l'extension non empaquetée** et choisir le dossier `Bulk-Attachments`.
4. Vérifier que l'ID affiché est bien `dbangjhmkaaijopbjedmcpjnnhndngfl`.
5. Épingler l'extension (icône puzzle de la barre d'outils → épingle).

Après toute modification d'un fichier de l'extension : bouton **Recharger** (flèche circulaire) sur la carte de l'extension dans `chrome://extensions`.

## Utilisation

1. Cliquer sur l'icône de l'extension : l'application s'ouvre dans un onglet.
2. **Se connecter** : Google affiche un avertissement « Google n'a pas validé cette application » (normal en statut « En test ») → **Continuer**, puis autoriser la lecture des e-mails.
3. Remplir les filtres et cliquer sur **Rechercher**. La requête Gmail générée s'affiche à gauche du bouton.
4. Cocher ou décocher les pièces jointes voulues.
5. Choisir le format et l'organisation, puis **Télécharger la sélection**. Les fichiers arrivent dans le dossier de téléchargements de Chrome.

Gardez l'onglet ouvert pendant le téléchargement ; le bouton **Annuler** de la barre de progression interrompt l'opération.

## Limites connues

- **Compte utilisé** : `chrome.identity` utilise le compte Google connecté au profil Chrome. Pour traiter une autre boîte Gmail, ouvrez un autre profil Chrome connecté à ce compte et chargez-y l'extension (et ajoutez ce compte dans les utilisateurs test).
- **Statut « En test »** : Google peut redemander votre autorisation environ tous les 7 jours. Cliquez simplement à nouveau sur **Se connecter**.
- **Mémoire** : en mode ZIP, chaque archive est construite en mémoire avant d'être enregistrée. Gardez une taille maximale par ZIP raisonnable (1 000 Mo par défaut) ; pour de très gros volumes, préférez le mode « fichiers séparés ».
- **Fichiers Google Drive** : les liens Drive insérés dans un e-mail ne sont pas des pièces jointes et ne sont pas téléchargés.
- **Option Chrome « Demander dans quel dossier enregistrer chaque fichier »** : à désactiver (`chrome://settings/downloads`) avant un téléchargement en fichiers séparés, sinon Chrome ouvre une fenêtre par fichier.
- **Taille minimale** : le filtre Gmail `larger:` porte sur la taille totale de l'e-mail, pas sur chaque pièce jointe.

## Structure du projet

| Fichier | Rôle |
| --- | --- |
| `manifest.json` | Déclaration de l'extension (permissions, OAuth, clé d'ID) |
| `background.js` | Ouvre l'application au clic sur l'icône, avec la recherche Gmail en cours |
| `app.html`, `app.css`, `app.js` | Interface : connexion, recherche, sélection, téléchargement |
| `lib/gmail.js` | Client API Gmail et fonctions pures (requête, extraction, nommage) |
| `lib/jszip.min.js` | JSZip 3.10.1 (licence MIT), création des archives ZIP |
| `icons/` | Icônes de l'extension |
| `tests/gmail.test.mjs` | Tests unitaires des fonctions pures : `npm test` |
| `tests/e2e.mjs` | Test de bout en bout : la vraie page `app.html` dans Chrome headless, avec les API Chrome et Gmail simulées (29 vérifications : recherche, pagination, doublons, filtres, ZIP, découpage, fichiers séparés, index CSV, réglages, déconnexion) |

## Tests

```bash
npm install          # puppeteer-core et jszip, uniquement pour les tests
npm test             # tests unitaires
npm run test:e2e     # test de bout en bout (Google Chrome doit être installé)
rm -rf node_modules  # avant de recharger l'extension dans Chrome
```

Chrome charge tout le contenu du dossier de l'extension : supprimez `node_modules` après les tests pour ne pas l'alourdir.
