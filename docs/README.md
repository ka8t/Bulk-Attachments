# Bulk Attachments pour Gmail

Extension Chrome (Manifest V3) qui télécharge en masse les pièces jointes des e-mails sélectionnés dans Gmail, sur le modèle de « Save Bulk Gmail Attachments ».

## Fonctionnalités

- Popup sur la page Gmail en cours, sans nouvel onglet : un clic sur l'icône lit ce qui est sélectionné dans Gmail.
- Quatre cas reconnus :
  - **E-mails cochés** dans la liste : toutes les pièces jointes de ces conversations, analysées dès l'ouverture.
  - **Conversation ouverte** : ses pièces jointes, analysées dès l'ouverture.
  - **« Sélectionner les N conversations correspondant à cette recherche »** : toute la recherche, relancée via l'API.
  - **Rien de coché** : proposition d'analyser toute la vue (recherche, recherche avancée, libellé, boîte de réception…).
- Liste des pièces jointes avant téléchargement : cases à cocher, filtre texte.
- Le téléchargement continue si la popup se ferme ; la progression s'affiche sur l'icône de l'extension (pourcentage, puis « OK »).
- Avertissement si le compte affiché dans Gmail diffère du compte autorisé par l'extension.
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

1. Dans Gmail, cocher les e-mails voulus (ou ouvrir une conversation, ou faire une recherche).
2. Cliquer sur l'icône de l'extension : la popup affiche la sélection et la liste des pièces jointes.
3. Première fois : **Se connecter à Gmail**. Google affiche « Google n'a pas validé cette application » (normal en statut « En test ») → **Continuer**, puis autoriser la lecture. Si la popup se ferme pendant l'autorisation, la rouvrir.
4. Décocher les pièces jointes inutiles ; régler format et rangement dans **Options** (réglages conservés).
5. **Télécharger** : les fichiers arrivent dans le dossier de téléchargements de Chrome. La popup peut être fermée ; **Annuler** interrompt l'opération.

## Limites connues

- **Compte utilisé** : `chrome.identity` utilise le compte Google connecté au profil Chrome. Si Gmail affiche un autre compte (`/mail/u/1/`…), la popup le signale. Pour traiter une autre boîte Gmail, ouvrez un autre profil Chrome connecté à ce compte et chargez-y l'extension (et ajoutez ce compte dans les utilisateurs test).
- **Lecture de la page Gmail** : la sélection est lue dans la structure de la page (`tr.zA`, `aria-checked`, `data-legacy-thread-id`). Si Google modifie cette structure, la détection devra être adaptée dans `readGmailSelection` (`lib/gmail.js`).
- **Statut « En test »** : Google peut redemander votre autorisation environ tous les 7 jours. Cliquez simplement à nouveau sur **Se connecter**.
- **Mémoire** : en mode ZIP, chaque archive est construite en mémoire avant d'être enregistrée. Gardez une taille maximale par ZIP raisonnable (1 000 Mo par défaut) ; pour de très gros volumes, préférez le mode « fichiers séparés ».
- **Fichiers Google Drive** : les liens Drive insérés dans un e-mail ne sont pas des pièces jointes et ne sont pas téléchargés.
- **Option Chrome « Demander dans quel dossier enregistrer chaque fichier »** : à désactiver (`chrome://settings/downloads`) avant un téléchargement en fichiers séparés, sinon Chrome ouvre une fenêtre par fichier.
- **Recherche avancée** : les champs du formulaire de recherche avancée de Gmail sont traduits en requête (expéditeur, destinataire, objet, mots, exclusions, dossier, taille, période autour d'une date). Le filtre de taille de Gmail porte sur l'e-mail entier, pas sur chaque pièce jointe.

## Structure du projet

| Fichier | Rôle |
| --- | --- |
| `manifest.json` | Déclaration de l'extension (permissions, OAuth, clé d'ID) |
| `popup.html`, `popup.css`, `popup.js` | Popup : lit la sélection de l'onglet Gmail, affiche les pièces jointes, pilote le moteur |
| `offscreen.html`, `offscreen.js` | Moteur dans un document hors écran : analyse, construction des ZIP ; survit à la fermeture de la popup |
| `background.js` | Service d'arrière-plan : jeton OAuth, téléchargements, badge de l'icône, création du moteur |
| `lib/gmail.js` | Client API Gmail, lecture de la page Gmail, traduction de la vue en requête, extraction, nommage |
| `lib/jszip.min.js` | JSZip 3.10.1 (licence MIT), création des archives ZIP |
| `icons/` | Icônes de l'extension |
| `tests/gmail.test.mjs` | Tests unitaires des fonctions pures : `npm test` |
| `tests/e2e.mjs` | Test de bout en bout de la vraie extension chargée dans Chrome headless : fausse page Gmail, API Gmail et jeton simulés, vrais téléchargements (31 vérifications : connexion, sélection cochée, conversation ouverte, toute la recherche, rien de coché, ZIP, découpage, fichiers séparés, popup fermée pendant le téléchargement, badge, compte différent, hors Gmail, déconnexion) |

## Tests

```bash
npm install          # puppeteer-core et jszip, uniquement pour les tests
npm test             # tests unitaires
npm run test:e2e     # test de bout en bout (Google Chrome doit être installé)
rm -rf node_modules  # avant de recharger l'extension dans Chrome
```

Chrome charge tout le contenu du dossier de l'extension : supprimez `node_modules` après les tests pour ne pas l'alourdir.
