# Bulk Attachments pour Gmail

Extension Chrome qui télécharge en masse les pièces jointes des e-mails sélectionnés dans Gmail, sur le modèle de « Save Bulk Gmail Attachments ».

Principe : vous cochez des e-mails dans Gmail, vous cliquez sur l'icône de l'extension ; une popup s'ouvre au-dessus de Gmail, liste leurs pièces jointes et les télécharge en archive ZIP ou en fichiers séparés.

## Documentation

| Document | Contenu |
| --- | --- |
| Ce fichier | Présentation, installation, mise à jour, désinstallation |
| [UTILISATION.md](UTILISATION.md) | Guide d'utilisation : cas reconnus, options, fichiers produits, dépannage |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Fonctionnement interne : composants, messages, API Gmail, lecture de la page, tests |

## Fonctionnalités

- **Popup sur la page Gmail** : aucun nouvel onglet ; l'extension lit ce qui est sélectionné dans Gmail.
- **Quatre cas reconnus** : e-mails cochés, conversation ouverte, « toutes les conversations correspondant à cette recherche », ou toute la vue en cours quand rien n'est coché.
- **Liste avant téléchargement** : cases à cocher, filtre texte, doublons et images de signature repérés.
- **Formats** : archive ZIP (découpée au-delà d'une taille maximale) ou fichiers séparés.
- **Rangement** : dossiers par expéditeur, mois, jour, type de fichier ou e-mail ; noms préfixés par la date ou l'expéditeur.
- **Index CSV** : date, expéditeur, objet, fichier, chemin, statut et lien Gmail de chaque pièce jointe, lisible dans Excel.
- **Travail en arrière-plan** : le téléchargement continue si la popup se ferme ; la progression s'affiche sur l'icône.

## Confidentialité

- **Lecture seule** : l'extension utilise l'API Gmail officielle avec le seul droit `gmail.readonly`. Elle ne peut ni envoyer, ni modifier, ni supprimer un e-mail.
- **Aucun serveur tiers** : tout se passe dans votre navigateur. Connexions sortantes : `gmail.googleapis.com` (lecture des e-mails) et `oauth2.googleapis.com` (révocation de l'autorisation à la déconnexion).
- **Page Gmail** : l'extension lit uniquement l'état des cases à cocher et les identifiants de conversation, au moment où vous ouvrez la popup.

OAuth : protocole d'autorisation de Google. Vous accordez à l'extension un accès limité à votre compte sans lui donner votre mot de passe. Google exige que chaque application utilisant l'API Gmail possède son propre « identifiant client OAuth », déclaré dans un projet Google Cloud.

## Configuration Google Cloud actuelle

Déjà faite pour ce dépôt :

| Élément | Valeur |
| --- | --- |
| Projet Google Cloud | `bulk-attachments` (« Bulk Attachments ») |
| API activée | Gmail API |
| Écran de consentement | Externe, statut « En test » |
| Utilisateurs test | l'adresse Gmail du propriétaire du projet |
| Client OAuth | type « Extension Chrome », `377933113644-91aansd2k7q3tkpbicu7jugil6ml1i00.apps.googleusercontent.com` |
| ID de l'extension | `dbangjhmkaaijopbjedmcpjnnhndngfl` |

Statut « En test » : seuls les comptes listés dans **Utilisateurs test** peuvent se connecter (100 au maximum). Un compte absent de la liste reçoit « Accès bloqué : Bulk Attachments n'a pas terminé la procédure de validation de Google ».

**Autoriser une autre adresse Gmail** : <https://console.cloud.google.com/auth/audience?project=bulk-attachments> → **Utilisateurs test** → **Add users** → saisir l'adresse, Entrée → **Enregistrer**. Recharger la page pour vérifier que l'adresse apparaît bien dans la liste.

## Installation

### Sur une machine avec ce dépôt (cas courant)

1. Récupérer le dossier : `git clone https://github.com/ka8t/Bulk-Attachments.git` (ou utiliser le dossier existant).
2. Ouvrir `chrome://extensions`.
3. Activer le **Mode développeur** (en haut à droite).
4. Cliquer sur **Charger l'extension non empaquetée** et choisir le dossier `Bulk-Attachments`.
5. Vérifier que l'ID affiché est `dbangjhmkaaijopbjedmcpjnnhndngfl`.
6. Épingler l'extension : icône puzzle de la barre d'outils → épingle à côté de « Bulk Attachments pour Gmail ».
7. Vérifier que le compte Google du profil Chrome (avatar en haut à droite de Chrome) figure dans les utilisateurs test.

L'ID de l'extension est figé par la clé publique `key` de `manifest.json` : il reste identique sur toutes les machines, donc l'identifiant OAuth fonctionne partout sans reconfiguration. Ne modifiez jamais cette clé.

### Refaire la configuration Google Cloud (autre projet, autre propriétaire)

À faire une seule fois, environ 10 minutes :

1. <https://console.cloud.google.com/> : créer un projet.
2. **API et services → Bibliothèque** : rechercher **Gmail API**, cliquer sur **Activer**.
3. **Google Auth Platform → Commencer** :
   - Nom de l'application : `Bulk Attachments` ; adresse e-mail d'assistance : la vôtre.
   - Audience : **Externe** (ou **Interne** pour un usage limité à une organisation Google Workspace).
   - Coordonnées : votre adresse e-mail.
   - Accepter le règlement sur les données utilisateur des API Google, puis **Créer**.
4. **Audience → Utilisateurs test → Add users** : ajouter chaque adresse Gmail autorisée, **Enregistrer**, puis recharger la page pour vérifier.
5. **Clients → Créer un client** :
   - Type d'application : **Extension Chrome**.
   - ID de l'article : `dbangjhmkaaijopbjedmcpjnnhndngfl`.
   - Créer, puis copier l'**ID client** (terminé par `.apps.googleusercontent.com`).
6. Dans `manifest.json`, remplacer la valeur de `oauth2.client_id` par cet ID client.
7. Charger ou recharger l'extension dans `chrome://extensions`.

Google indique qu'un nouvel identifiant peut mettre de quelques minutes à quelques heures à devenir actif.

## Mise à jour

1. Récupérer la nouvelle version : `git pull` dans le dossier `Bulk-Attachments`.
2. `chrome://extensions` → bouton **Recharger** (flèche circulaire) sur la carte de l'extension.
3. Recharger les onglets Gmail ouverts.

Le rechargement est obligatoire après toute modification d'un fichier de l'extension, et en particulier de `manifest.json`.

## Désinstallation et révocation

- **Retirer l'autorisation Gmail** : bouton **Se déconnecter** en bas de la popup, ou <https://myaccount.google.com/permissions> → « Bulk Attachments » → **Supprimer l'accès**.
- **Supprimer l'extension** : `chrome://extensions` → **Supprimer** sur la carte de l'extension.
- **Supprimer la configuration Google** : console Google Cloud → projet `bulk-attachments` → **IAM et administration → Paramètres → Arrêter**.

## Tests

```bash
npm install          # puppeteer-core et jszip, uniquement pour les tests
npm test             # tests unitaires (11)
npm run test:e2e     # vraie extension dans Chrome headless (31 vérifications)
rm -rf node_modules  # Chrome charge tout le dossier de l'extension
```

Détail des tests : [ARCHITECTURE.md](ARCHITECTURE.md#tests).
