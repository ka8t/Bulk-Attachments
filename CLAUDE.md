# Bulk Attachments — consignes pour Claude

Extension Chrome (Manifest V3) qui télécharge en masse les pièces jointes Gmail via l'API Gmail officielle (lecture seule). Documentation complète : `docs/README.md`.

## Règles générales

- Les documents de projet vont dans `docs/`. Le `README.md` à la racine reste une courte présentation qui renvoie vers `docs/README.md`.
- Messages de commit strictement neutres sur l'auteur : aucune mention de Claude, d'Anthropic ou d'une IA, aucune ligne `Co-Authored-By: Claude`, aucune signature générée.
- Ne jamais publier automatiquement quoi que ce soit sur une plateforme externe (Chrome Web Store, réseaux sociaux…) : préparer le contenu, l'utilisateur publie lui-même après relecture. Pousser sur le dépôt GitHub `ka8t/Bulk-Attachments` reste autorisé quand l'utilisateur le demande.
- Ne jamais inventer une compétence, une expérience ou une réalisation de l'utilisateur dans un contenu qui le représente (description publique, présentation du projet).
- Prévenir l'utilisateur dès que l'usage hebdomadaire atteint 90 % ou plus, si l'information est visible.
- Le dépôt est **public** : aucune donnée personnelle (adresse e-mail, nom complet) ni secret dans les fichiers versionnés. Les identités Git utilisent l'adresse `noreply` de GitHub.

## Style d'écriture en français

S'applique à l'interface, à la documentation, aux commentaires et aux messages de commit.

- Accents français corrects partout (é, è, ê, à, ù, ç…), jamais de français en ASCII simplifié. Relire orthographe et grammaire.
- Ton direct : pas de tournure « ce n'est pas X, c'est Y », pas de formulation ampoulée. Des affirmations franches.
- Expliquer en clair tout terme technique au moment où il apparaît.
- Mener avec le fait concret avant la généralisation ; structurer par labels courts suivis de deux-points ; `==>` pour marquer une conséquence ; pas de méta-commentaire qui annonce ce qu'on va dire.

## Règles propres au projet

- **Clé du manifeste** : ne jamais modifier `key` dans `manifest.json`. Elle fixe l'ID de l'extension `dbangjhmkaaijopbjedmcpjnnhndngfl`, auquel est lié le client OAuth `oauth2.client_id`.
- **Droits Gmail** : rester en lecture seule (`gmail.readonly`). Tout nouveau droit oblige l'utilisateur à refaire l'autorisation et doit être déclaré dans Google Cloud (projet `bulk-attachments`).
- **Pas de code distant** : Manifest V3 l'interdit. Les bibliothèques sont copiées dans `lib/` avec une version figée (JSZip 3.10.1).
- **Logique testable** : les fonctions pures vont dans `lib/gmail.js`, sans API `chrome.*`, pour rester testables avec Node.
- **Tests avant chaque commit** :
  ```bash
  npm install && npm test && npm run test:e2e
  rm -rf node_modules   # Chrome charge tout le dossier de l'extension
  ```
  Toute nouvelle fonctionnalité de l'interface ajoute ses vérifications dans `tests/e2e.mjs`.
- **Architecture** : popup (`popup.js`) → moteur hors écran (`offscreen.js`, survit à la fermeture de la popup) → service d'arrière-plan (`background.js`, seul à avoir `chrome.identity` et `chrome.downloads`). Pas de nouvel onglet : l'utilisateur travaille depuis sa page Gmail.
- **DOM de Gmail** : la sélection est lue par `readGmailSelection` (`lib/gmail.js`), fonction injectée qui doit rester autonome. Repères relevés sur Gmail : `tr.zA`, `[role=checkbox][aria-checked]`, `[data-legacy-thread-id]` (= threadId de l'API), `h2.hP` pour une conversation ouverte. Toute évolution de ces repères se reporte aussi dans la fausse page Gmail de `tests/e2e.mjs`.
- **Automatisation du navigateur** : Claude in Chrome ne peut pas piloter les pages `chrome://` ni `chrome-extension://` ; le test de la vraie extension passe par `tests/e2e.mjs`. Sur le vrai Gmail de l'utilisateur : lecture de la structure uniquement, de préférence par JavaScript ; éviter de cliquer dans la liste (un clic décalé ouvre un e-mail et le marque comme lu) et remettre la sélection à zéro après tout essai.
- **Langue** : interface et documentation en français.
