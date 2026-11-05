# SC3 SETTINGS-UX — Présentation FIXE / laptop / Android Deck (05/11/2026)

## Demande et diagnostic
L'opérateur voit « Double-PC » sur le laptop sans comprendre où activer Android Deck. Audit de `apps/mobile/shared/installation.js`, `installation-ui.js`, `settings-view.js` et du parcours de `control.js` : un preset `dual-pc` est un **libellé de topologie**, pas une liste de pairs réellement associés. `dual-pc-deck` existe déjà mais n'appaire pas automatiquement un téléphone. L'ancien onglet « Appareils & macros » ne montrait qu'une table locale/serveur, sans explication sur FIXE maître, rôle client ni Android Deck. Sur le laptop, le bouton de création de code local faisait croire qu'un second agent/régie pouvait être nécessaire.

## Traitement étroit
- Nouveau rendu *lecture seule* `apps/mobile/control/settings-simplified.js` : trois sections distinctes (FIXE régie OBS/horloge, laptop contrôleur, Android Deck téléphonique). Identités présentées avec échappement HTML, états « prévu », « déclaré », « non vérifié » distincts ; aucun terminal Android connecté n'est inventé. Les appareils déclarés dans la topologie locale ne constituent pas des observations réseau.
- Le client laptop retrouve une action explicite « Associer FIXE » et les boutons Deck, mais **ne reçoit pas** une proposition de créer un code d'association hôte. C'est FIXE qui propose une association Android directe après clic et sans transfert de secret.
- Onglets renommés `Paramètres → OBS et scènes / Twitch / Préférences / Connexions / Appareils & Deck`. Le bandeau annonce clairement sur quel appareil les réglages portent. Les éditeurs techniques des récompenses Twitch et tags JSON sont repliés sous `Avancé`, mais leurs champs, noms et valeurs restent dans le formulaire de sauvegarde existant.
- `installation-ui.js` explique explicitement que « Double-PC + Android Deck » ne pairera aucun appareil sans étape d'association à FIXE. Les autres outils (comptes, migrations, sauvegardes, raccourcis, boutons Deck) restent accessibles.
- Aucun contrat de stockage, schéma, route API, OAuth, profil, valeur par défaut ou action automatique OBS/Twitch changé ; le garde OBS scènes et micro récemment intégré dans le commit séparé `05b5687` est **préservé**.

## Qualification sur FIXE
- Commit source de départ : `05b5687` ; branche `streamcockpit/3.0-full-experience`, remote GitHub attendu. Cinq fichiers F05/CONTINUITY déjà modifiés, appartenant à un autre propriétaire et jamais modifiés ni indexés pour ce lot.
- Campagne ciblée : quatre fichiers Vitest, **25 PASS / 0 FAIL / 0 skipped**, dont un véritable test Edge sur 320, 390 et 1366 px pour la nouvelle topologie et un test Edge sur la préservation OBS. Tests de rôle client/Google, compatibilité navigation mobile et paramètres OBS validés. Log `%TEMP%\sc3-settings-cleanup-qa-20261105.log`.
- `tsc -p tsconfig.json --noEmit` PASS ; `tsc -p tsconfig.browser-js.json` PASS ; `security-check` PASS (**6755 fichiers examinés**) ; `node --check` du nouveau module PASS et `git diff --check` PASS (avertissements CRLF sans erreur). Log `%TEMP%\sc3-settings-cleanup-static-20261105.log`.
- Pas de test sur un téléphone Android réel ni de nouvelle construction et installation QA. L'installation Windows/Android QA `73a6aae` utilisée par l'opérateur **n'intègre pas ce changement tant qu'un nouveau build n'est pas construit**, vérifié et installé séparément.
- F07 garde le statut `partial`, G2 `in_progress` et G3–G5 `open`. La source comporte désormais une aide de configuration ; elle ne réalise pas l'appairage sur le matériel.

## Suite nécessaire
1. Une fois les propriétaires de fichiers libres et les flux G2 prêts, inclure ces écrans dans une paire QA Windows/Android issue d'un **même commit** et demander l'accord pour une installation parallèle.
2. Sur FIXE : vérifier l'authentification OBS (port 4555 constaté) et créer l'association Android avec contrôle d'identité/permissions. Sur le laptop : confirmer la régie FIXE, sans second maître.
3. Réception réelle Android + laptop avec changements de source Wi-Fi/veille, boutons Deck, chat et reçus, puis G4 signatures et rollback avant G5.
