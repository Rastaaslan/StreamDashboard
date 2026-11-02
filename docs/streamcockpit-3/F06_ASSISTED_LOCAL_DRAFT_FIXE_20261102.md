# F06 — Ouvrir un brouillon local depuis un créneau suggéré (FIXE, 2026-11-02)

## Périmètre et branche
- Développement uniquement sur FIXE Windows 11 via Remote Desktop Commander, branche canonique `streamcockpit/3.0-full-experience`, départ `b200a3a` synchronisé. Branche Q isolée, RC2 de secours, installations Windows/Android/laptop, OBS/Twitch et dam-server intacts.
- Sous-lot F06 indépendant du lot F08 raids en cours sur les mêmes sources serveur/Twitch. Aucun de ses fichiers API, tests, contrôles LIVE ou service worker n'est propriétaire de F06.
- Les règles de récurrence et les dates avec fuseau proviennent du moteur existant `streamcockpit-planning.js`. Le code canonique TypeScript et la transpilation contrôlée ne sont pas modifiés.

## Parcours réellement branché en développement
- Les trois propositions locales de 60 min des prochaines 24 heures présentent désormais « Vérifier et préparer un brouillon local », désactivé si la connexion de la régie n'est pas disponible. Départ suggéré au moins quinze minutes après l'horloge de lecture.
- Un clic volontaire provoque `refresh(true)` de la régie sélectionnée puis contrôle son `hostname`; refus si régie déconnectée ou remplacée. `prepareAssistedLocalDraft` passe la copie courante dans `inspectPlanningSlot` du moteur canonique, y compris événements importés Google présents localement, récurrences, exceptions, conflits et suppressions en attente. Créneau devenu occupé = refus, aucun éditeur ouvert.
- Après contrôle, seul l'éditeur existant `planning-event-form` s'ouvre avec les horaires préremplis, type Live, Google/Twitch décochés et aucun ID fournisseur. **Aucune écriture à l'ouverture**.
- L'utilisateur doit saisir/valider le formulaire et appuyer sur Enregistrer. Avant l'unique `POST /api/v2/planning`, le flux assisté impose local uniquement, sans récurrence, relit `refresh(true)` du **même hôte**, puis refait le contrôle des conflits et de la date future. Aucun renvoi automatique d'écriture ou deuxième régie.
- Les suggestions ne sont **pas** une observation de disponibilité Google ou Twitch ; leur état reste explicitement UNKNOWN. Une copie de l'agenda n'est pas une garantie d'absence de changements concurrents pendant le POST et aucune comparaison-et-écriture atomique n'a été ajoutée au backend. Le bouton antérieur « Dupliquer vers un brouillon » demeure volontairement désactivé.

## Preuves et limitations
- Nouveaux tests `tests/streamcockpit3-planning-assisted-draft.test.ts` : 22 PASS (unité, récurrences/DST, modifications en cours, cas offline et contrat de POST local).
- Tests `tests/streamcockpit3-planning-assistant-browser.test.ts` : 2 PASS dans Microsoft Edge réel 320px (préparation puis sauvegarde explicite simulée ; changement d'hôte bloqué).
- Trois suites ciblées F06 précédentes + nouvelle suite : 46 PASS / 0 fail sur la version avant tests Edge ; Edge+F06 24 PASS / 0 fail. Les essais navigateur simulent l'API, aucune donnée réelle n'a été créée.
- Reste : conflit atomique côté backend au moment d'une création, vérification de la fraîcheur Google réelle, boucle de duplication d'une occurrence depuis le compte Google, tests de reconnexion sur Android physique, migrations, signatures et rollback. F06 demeure `partial`, G2 `in_progress`, G3–G5 `open`.

## Clôture de validation sur FIXE (soir du 02/11)
- Quatre suites ciblées avec Edge réel 320 px : **51/51 PASS**, exit 0.
- Vitest complet avec OpenSSL Git en PATH du test : **2106 PASS / 82 skipped / 0 FAIL**, exit 0 ; les skips sont hors qualification.
- Build développement, JS livré, TypeScript, types navigateur et contrôle sécurité final **849 fichiers** PASS.
- Suite Node initiale : 348 PASS / 6 skipped / 1 FAIL dans `desktop-audit.node.test.mjs`, attente de WebSocket trop précoce. Test renforcé par attente de l'événement de connexion bornée à 5 s ; test isolé 1/1 PASS ; suite Node complète **349 PASS / 6 skipped / 0 FAIL**, exit 0.
- Playwright réseau local et UI mobile : **35/35 PASS**, exit 0.
- Toutes les limitations de concurrence côté serveur, fournisseur Google/Twitch, matériel physique, migrations, signatures et rollback demeurent. F06 partial, G2 in_progress, G3–G5 open ; aucun installateur/APK/RC.
