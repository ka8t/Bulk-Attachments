# Guide d'utilisation

## En bref

1. Dans Gmail, cochez les e-mails voulus (ou ouvrez une conversation, ou lancez une recherche).
2. Cliquez sur l'icône de l'extension (flèche blanche sur fond orange) : la popup s'ouvre au-dessus de Gmail.
3. Vérifiez la liste des pièces jointes, décochez celles qui ne vous intéressent pas.
4. Cliquez sur **Télécharger N fichiers** : les fichiers arrivent dans le dossier de téléchargements de Chrome.

## Première connexion

Au premier usage, la popup affiche **Se connecter à Gmail** :

1. Cliquer sur le bouton : une fenêtre Google s'ouvre.
2. Google affiche « Google n'a pas validé cette application » : normal pour une application en statut « En test ». Cliquer sur **Continuer**.
3. Autoriser la lecture des e-mails.
4. Si la popup s'est fermée pendant l'autorisation, la rouvrir : l'analyse démarre.

Le compte utilisé est celui du profil Chrome (avatar en haut à droite de Chrome), pas forcément celui affiché dans Gmail. Le compte autorisé apparaît en haut à droite de la popup.

## Ce que la popup reconnaît

| Situation dans Gmail | Titre dans la popup | Comportement |
| --- | --- | --- |
| Un ou plusieurs e-mails cochés dans la liste | « N conversations sélectionnées » | Analyse immédiate de toutes les pièces jointes de ces conversations |
| Une conversation ouverte | « Conversation ouverte » + objet | Analyse immédiate de ses pièces jointes |
| Case générale cochée puis lien « Sélectionner les N conversations correspondant à cette recherche » | « Les N conversations de la recherche » | Bouton **Analyser** : la recherche est relancée via l'API Gmail |
| Rien de coché | « Aucun e-mail coché » + requête de la vue | Bouton **Analyser** : toute la vue en cours (recherche, recherche avancée, libellé, boîte de réception…) |

Une conversation regroupe plusieurs e-mails (un échange et ses réponses) : cocher une conversation prend les pièces jointes de tous ses e-mails.

Pour « toute la vue » et « toute la recherche », seuls les e-mails qui ont une pièce jointe sont lus (`has:attachment` est ajouté à la requête), dans la limite du **Nombre maximal d'e-mails** (500 par défaut).

## La liste des pièces jointes

- **Ligne** : nom du fichier, taille, puis expéditeur · date · objet de l'e-mail.
- **Étiquette « doublon »** : même nom et même taille qu'une pièce jointe plus ancienne (fichier transféré ou renvoyé). Décochée par défaut ; l'exemplaire le plus ancien reste coché.
- **Étiquette « intégrée »** : image affichée dans le corps de l'e-mail (logo, signature). Masquée par défaut, visible avec l'option **Inclure les images intégrées**.
- **Case générale** (à gauche du compteur) : coche ou décoche toutes les lignes affichées.
- **Filtrer…** : n'affiche que les lignes contenant le texte saisi (nom, expéditeur ou objet). La case générale n'agit alors que sur les lignes filtrées.
- **Compteur** : pièces jointes cochées / trouvées · nombre d'e-mails concernés.
- **Actualiser** : relance l'analyse, par exemple après avoir changé une option d'analyse.

## Options

Ouvrir **Options** sous la liste. Les réglages sont mémorisés pour les prochaines fois.

### Téléchargement

| Option | Valeurs | Défaut |
| --- | --- | --- |
| Format | Archive ZIP ; Fichiers séparés | Archive ZIP |
| Dossiers | Aucun ; par adresse de l'expéditeur ; par nom de l'expéditeur ; par mois (AAAA-MM) ; par jour (AAAA-MM-JJ) ; par type de fichier (PDF, DOCX…) ; un dossier par e-mail (date + objet) | Aucun dossier |
| Nom des fichiers | Nom d'origine ; date + nom ; expéditeur + nom ; date + expéditeur + nom | Nom d'origine |
| Nom de l'archive ou du dossier | Texte libre | `Gmail-pieces-jointes_AAAA-MM-JJ_HHhMM` |
| Taille maximale par ZIP (Mo) | 50 et plus | 1 000 |
| Compresser | Oui / non. Gain faible sur PDF et images, déjà compressés | Non |
| Ajouter un index CSV | Oui / non | Oui |

### Analyse

| Option | Effet | Défaut |
| --- | --- | --- |
| Décocher les doublons | Décoche les pièces jointes de même nom et même taille | Oui |
| Inclure les images intégrées | Ajoute logos et images de signature | Non |
| Extensions à garder | Ne garde que ces types, ex. `pdf, docx` (vide = tous) | Vide |
| Nombre maximal d'e-mails | Limite pour « toute la vue » et « toute la recherche » | 500 |

Une option d'analyse modifiée s'applique au clic sur **Actualiser**.

## Fichiers produits

Emplacement : le dossier de téléchargements de Chrome (`~/Downloads` par défaut sur Mac).

### Archive ZIP

Exemple avec « Dossiers : par mois » et « Nom des fichiers : date + nom » :

```
Gmail-pieces-jointes_2026-10-18_14h05.zip
├── 2025-06/2025-06-24_Bord_1-013-0102.pdf
├── 2025-09/2025-09-17_Bord_1-013-0102.pdf
└── index.csv
```

- Chaque fichier porte la date de l'e-mail comme date de modification.
- Au-delà de la taille maximale, l'archive est découpée : `…_partie-1-sur-2.zip`, `…_partie-2-sur-2.zip`, chacune avec son propre index.

### Fichiers séparés

Un dossier au nom choisi, avec les sous-dossiers demandés et `index.csv`.

Avant ce mode, désactivez l'option Chrome **Demander dans quel dossier enregistrer chaque fichier** (`chrome://settings/downloads`), sinon Chrome ouvre une fenêtre par fichier.

### Noms de fichiers

- Les caractères interdits par Windows ou macOS (`\ / : * ? " < > | ~`) sont remplacés par `_` : `rapport:final?.docx` devient `rapport_final_.docx`.
- Deux fichiers de même nom dans le même dossier : le second devient `facture (2).pdf`, puis `facture (3).pdf`…
- Noms trop longs : coupés à 120 caractères, extension conservée.

### Index CSV

Séparateur `;` et encodage UTF-8 avec BOM : Excel l'ouvre directement avec les accents.

| Colonne | Contenu |
| --- | --- |
| Date | Date et heure de l'e-mail |
| Expéditeur, Adresse | Nom et adresse de l'expéditeur |
| Objet | Objet de l'e-mail |
| Fichier d'origine | Nom de la pièce jointe dans Gmail |
| Taille (octets) | Taille du fichier |
| Chemin enregistré | Emplacement dans le ZIP ou le dossier |
| Statut | `OK` ou `Échec : <raison>` |
| Lien Gmail | Ouvre la conversation dans Gmail |

**Exporter la liste (CSV)** produit `Gmail-liste-pieces-jointes_AAAA-MM-JJ.csv` avec les pièces jointes cochées, sans rien télécharger (colonnes sans chemin ni statut).

## Pendant le téléchargement

- **Progression** : barre dans la popup et pourcentage sur l'icône de l'extension.
- **Popup fermée** : le téléchargement continue. En rouvrant la popup, la progression reprend.
- **Annuler** : interrompt l'opération ; les fichiers déjà enregistrés restent.
- **Fin** : l'icône affiche « OK » pendant 15 secondes ; la popup liste les fichiers enregistrés et les éventuels échecs.
- **Échec d'une pièce jointe** : signalé dans la popup et dans l'index CSV ; les autres fichiers sont enregistrés normalement.

## Dépannage

| Symptôme | Cause | Solution |
| --- | --- | --- |
| « Accès bloqué : Bulk Attachments n'a pas terminé la procédure de validation de Google » | Le compte du profil Chrome n'est pas dans les utilisateurs test | L'ajouter (voir [README.md](README.md#configuration-google-cloud-actuelle)), puis **Se connecter à Gmail** |
| « Google n'a pas validé cette application » | Application en statut « En test » | Cliquer sur **Continuer** |
| La popup redemande la connexion | En statut « En test », Google peut redemander l'autorisation environ tous les 7 jours | Cliquer sur **Se connecter à Gmail** |
| Bandeau jaune « Gmail affiche le compte X, mais l'extension lit le compte Y » | Gmail ouvert sur un autre compte (`/mail/u/1/`…) que celui du profil Chrome | Utiliser le profil Chrome du compte voulu, y charger l'extension |
| « Ouvrez Gmail, cochez les e-mails voulus… » alors que Gmail est ouvert | L'onglet actif n'est pas une page `https://mail.google.com/` | Cliquer sur l'onglet Gmail, puis sur l'icône |
| « Lecture de la page Gmail impossible » | Gmail encore en chargement, ou onglet ouvert avant l'installation | Recharger l'onglet Gmail |
| « Aucune pièce jointe dans cette sélection » | E-mails sans pièce jointe, avec seulement des images intégrées ou des liens Google Drive | Option **Inclure les images intégrées** ; les liens Drive ne sont pas des pièces jointes |
| « Limite du nombre d'e-mails atteinte » | La vue ou la recherche dépasse le nombre maximal d'e-mails | Augmenter **Nombre maximal d'e-mails** puis **Actualiser**, ou affiner la recherche Gmail |
| Une fenêtre « Enregistrer sous » par fichier | Option Chrome « Demander dans quel dossier enregistrer chaque fichier » active | La désactiver dans `chrome://settings/downloads` |
| Le ZIP n'apparaît pas | Téléchargement bloqué ou encore en cours | Vérifier `chrome://downloads` |
| Erreur « Gmail 429 » ou « quota » | Trop de requêtes en peu de temps | Attendre une minute ; l'extension réessaie déjà automatiquement |
| Rien ne change après une mise à jour du code | Extension non rechargée | `chrome://extensions` → **Recharger**, puis recharger Gmail |

## Limites

- **Liens Google Drive** : un fichier partagé par lien Drive n'est pas une pièce jointe et n'est pas téléchargé.
- **Mémoire** : chaque ZIP est construit en mémoire. Pour plusieurs gigaoctets, gardez une taille maximale par ZIP raisonnable ou utilisez les fichiers séparés.
- **Filtre de taille de la recherche Gmail** : il porte sur l'e-mail entier, pas sur chaque pièce jointe.
- **Structure de Gmail** : la sélection est lue dans la page. Si Google modifie l'interface de Gmail, la détection peut cesser de fonctionner jusqu'à une mise à jour de l'extension.
