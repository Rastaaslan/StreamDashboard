# SC3-SETTINGS-P02 — Régie hors ligne et état Google non vérifié

**Date :** 05/11/2026. **Machine :** FIXE Windows 11, Remote Desktop Commander uniquement. **Source :** `streamcockpit/3.0-full-experience`, HEAD initial `c142328`. **Périmètre :** code source et tests, sans accès aux installations.

## Inventaire des réglages affichés (Windows Administration / Android Plus)

| Parcours / réglages | Propriétaire effectif | Source / dépendance | Effet ou limite |
| --- | --- | --- | --- |
| Appareils & Deck : modèle, inventaire, rôles, association, permissions, connexion sécurisée | Topologie de l'installation et FIXE pour les grants | `settings-simplified.js`, installation et pairing ; présence réseau séparée | Le modèle et l'inventaire déclaré ne prouvent ni appairage ni présence Android. Aucune régie supplémentaire. |
| OBS & scènes : WebSocket, mot de passe, micro, INTRO/JEU/PAUSE/FIN/Discussion, mode de lancement | FIXE uniquement | `settings-view.js` -> formulaire `settings-form` -> `PUT /api/v2/settings` avec révision ; listes OBS observées | Enregistre la configuration du maître ; un client appairé vise FIXE. Les valeurs non détectées sont conservées. |
| OBS avancé : overlay minuteur, launchObs, chemin exécutable, ouverture LAN | FIXE uniquement | Même service settings ; vérifications OBS/permissions/reprise externes | Aucune mise en service ni connexion OBS déduite de ces valeurs. |
| Twitch : identité OAuth, connexion, sorties OBS (type/nom) | Compte local facultatif sur Android autonome ; service Twitch/OBS sur FIXE pour la régie | `device-accounts.js` sur appareil autonome ; `platform-form` -> `PUT /api/v2/configuration` ; état du fournisseur distinct | Compte Twitch ≠ WebSocket OBS. Sortie configurée ≠ diffusion active ni scope OAuth valide. |
| Google Agenda / planning | FIXE pour planning maître ; compte local facultatif sur client isolé | `integrations`, OAuth Google, observation `host.state.google.connected` ; synchronisation planning distincte | « Connecté » ne garantit ni fraîcheur ni droits calendrier. Quand FIXE est hors ligne, preuve Google non disponible. |
| Audio / sons / raccourcis | OBS et soundboard FIXE ; raccourcis locaux uniquement sur machine de saisie | `sounds`, `sound-setup`, `shortcut-status`, mixeur propre à son chantier | Aucun routage nouveau et aucune promesse de séparation VOD matérielle à partir de l'interface. |
| Discord, Streamlabs, WizeBot et automatisations | Services configurés sur la régie ; scopes propres à chacun | Boutons `discord`, `streamlabs`, `wizebot-catalog`, `automations` | Ouvrir leur outil n'atteste pas une connexion ou un token valide. |
| Préférences : navigation, stockage et écran éveillé | Client courant (Windows ou Android) | `localStorage`, actions `navigation-mode`, `storage`, `keep-awake` | Aucun changement du host. Attention : le rendu « écran éveillé » suppose oui sauf valeur `false` ; défaut à vérifier plus tard. |
| Profil : nom, accent, confirmation d'arrêt, récompenses, tags JSON | Hôte sélectionné si appairé, sinon espace local | `profile-settings` -> `PUT /api/v2/settings` avec révision | Les préférences locales et le profil distant partagent un écran ; les sections sont explicitement nommées. |
| Avancé : migration, transferts de planning, macros et sons, permissions | Selon tâche : client local ou FIXE | `device-setup`, `setup-migration`, `planning-handoff`, `configuration-copy` | Un bouton affiché n'autorise ni migration automatique ni effacement de données. |

## Problème reproduit avant correction

Sur Android appairé avec une adresse FIXE enregistrée, `online=false` et un ancien `host.state.google.connected=true` : le panneau affichait **« Compte Google de la régie connecté »**, alors que le hôte ne répondait plus. Le sous-titre disait aussi **« Réglages de cet appareil »**, bien que les formulaires de régie ciblaient toujours le hôte. Il s'agit de deux manifestations d'un **même défaut de contexte hors ligne**, susceptible d'induire une mauvaise décision de configuration.

Tests RED avant correction : **5 PASS / 2 FAIL / 0 skipped** sur sept scénarios, dont **1 échec Edge réel 320 px** ; log `%TEMP%\sc3-settings-google-offline-red-20261105.log`. Aucune requête distante lancée.

## Correctif unique de contexte / fraîcheur

- Si une régie est sélectionnée mais non joignable, le sous-titre désigne maintenant la **régie hors ligne** et distingue explicitement navigation/stockage locaux de la configuration distante non vérifiable.
- Dans Connexions, l'état Google lié à FIXE devient **« Régie indisponible : état du compte Google non vérifiable »** tant que `online=false`. Les états « connecté » et « non connecté » sont seulement montrés si la régie sélectionnée répond.
- Aucun changement de schéma, credential, endpoint, rôle, appairage, état OBS, compte Google, publication Twitch, timer, migration, sauvegarde ni valeur par défaut.

## Qualification et frontières

- Après correction, **20 PASS / 0 FAIL / 0 skipped** dans quatre suites Settings (navigation, topologie, sélecteurs OBS, rôle Desktop), dont **2 scénarios Edge réels**, l'un à 320 px pour l'indisponibilité Google et l'autre sur 320/390/1366 px pour la navigation ; `%TEMP%\sc3-settings-google-offline-green-20261105.log`.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; syntaxe JS des deux modules PASS ; `npm run security:check` PASS (**6757 fichiers avant cette note**) ; `git diff --check` des fichiers du lot PASS ; log `%TEMP%\sc3-settings-google-offline-static-20261105.log`.
- Jeux de données et connectivités synthétiques : **pas** de test Google/Twitch OAuth réel, Android physique, laptop, interruption de live, contrôle des permissions de saisie, EXE/APK, signature ou rollback. Les autres données de connexion (Discord/WizeBot/Streamlabs, fraîcheur Google hors simple `online`) restent à auditer.
- **Propriété des fichiers :** modifications F05 déjà en cours dans trois JS mixeur + test mixeur et `CONTINUITY.md` constatées au préflight, jamais modifiées ni indexées. Ce compte rendu autonome constitue la continuité provisoire jusqu'à libération explicite de `CONTINUITY.md`.
- **Gates inchangées :** F00–F10 partiels selon matrice, G2 `in_progress`, G3/G4/G5 `open`. Aucun livrable diffusé ou installé. Le montage ClipForge avancé reste reporté V4 selon PLAN.
