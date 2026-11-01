# Lot F — F05, première passe sûre

Base : `627dca3`, branche `streamcockpit/3.0-lot-f`. État : implémentation isolée, non qualifiée matériellement. Aucun branchement actif, ordre OBS, appel Twitch, accès aux PC ou changement de données utilisateur. Matrice et continuité partagées inchangées.

## Fichiers livrés

- `packages/core/src/streamcockpit-mixer.ts` : contrat de preuves horodatées, projection read-only, prévisualisation gain/mute et valeurs inverses.
- `apps/server/src/streamcockpit-mixer.ts` : adaptation de `ObsState.inputs` et d'un lecteur de sorties locales ; façade de lecture/prévisualisation non montée.
- `apps/mobile/control/streamcockpit-mixer.js` : table sans commande, erreurs visibles, effacement sur échec, rejet des réponses dépassées.
- `tests/streamcockpit3-mixer.test.ts` : contrats, incohérences, USB, source disparue, propriétaire double PC, séparation Spotify/VOD.
- `tests/streamcockpit3-mixer-mobile.test.ts` : rendu textuel et courses de lecture sur DOM minimal.
- `docs/streamcockpit-3/LOT_F_MIXER.md` : présent rapport.

Le ticket préexistant `LOT_F_TICKET.md` n'est ni modifié ni inclus dans le commit.

## Sémantique et préconditions

Le gain est un multiplicateur OBS, le niveau une amplitude mesurée : gain positif ne prouve pas un signal. Niveau absent = inconnu, niveau mesuré zéro = silence observé. Chaque mesure porte provenance et date ; horizon conservateur de cinq secondes, dates futures rejetées. Les routes représentent une configuration observée, pas une garantie d'audibilité ni d'absence de fuite par une autre source.

Un plan exige révision exacte, inventaire frais de FIXE connecté, identités uniques, valeurs gain/mute valides, présence du périphérique et routes connues pour chaque source ciblée. Une source Spotify explicitement marquée comme exclue de VOD bloque si cette exclusion n'est pas observée. Les noms ne définissent jamais cette politique. Toute erreur bloque le plan complet ; aucune application partielle. `executable` est toujours faux, même pour `status: preview`. Aucun exécuteur n'est fourni.

Le rollback est uniquement une liste de valeurs antérieures pour les champs proposés. Une future application devra vérifier identité authentifiée, capacité, confirmation liée au plan exact, révision/source à nouveau valides, puis relecture après chaque changement. En cas d'échec, restaurer uniquement si la révision et les valeurs après application correspondent encore ; sinon déclarer un conflit et demander une intervention. Aucun rollback aveugle, retry ou automatisme audio.

## Limites et branchements réels nécessaires

1. Monter la façade derrière l'identité et les permissions existantes, et intégrer la table au parcours utilisateur. Les fonctions TypeScript sont internes et typées : toute future route réseau devra valider son JSON avant appel.
2. Fournir depuis l'Agent FIXE une révision faisant autorité, renouvelée à chaque reconnexion et changement pertinent, avec vraie date d'observation et identité stable de source. L'adaptateur actuel utilise les noms `ObsState` ; il ne détecte pas à lui seul une suppression/recréation sous le même nom. Le propriétaire fourni doit être dérivé de l'identité de l'Agent, jamais d'une requête client.
3. `ObsState.inputs` ne contient que les entrées dont les lectures audio ont réussi ; il ne décrit pas un inventaire exhaustif des erreurs par source. Son gain/mute est adapté, mais niveau, présence USB et routes restent inconnus. Brancher des preuves horodatées d'inventaire complet, de mesure audio, de pistes/monitoring et de configuration Twitch stream/VOD. Ne pas déduire les pistes 1/2 ni une route depuis `activeAudioInputs`.
4. `AudioDestinations.outputs()` absorbe les erreurs de ses backends. Ne pas l'utiliser comme preuve de santé : fournir un lecteur d'énumération qui propage les erreurs et des observations explicites de présence USB. Une sortie par défaut ou sélectionnable n'est pas une preuve de fonctionnement et ne déclenche aucun fallback. La liste affichée reste descriptive.
5. Le contexte Voicemeeter existant (`mic-health.ts`) confirme qu'un bus différent peut invalider une déduction d'audibilité. Aucun relevé de routage Voicemeeter/VOD de production n'est disponible dans ces interfaces. La fixture Spotify illustre uniquement une preuve synthétique de séparation ; les bus, pistes Twitch et sources agrégées devront être contrôlés sur matériel réel.
6. Vérifier ultérieurement FIXE/laptop/Android, perte USB, reconnexion, remplacement de source, VOD Spotify séparée et rollback réel sous pilotage utilisateur. Les tests DOM minimaux ne remplacent pas un navigateur ou un Android réel. Aucun build Windows/Android, push ou déploiement effectué.

## Vérifications

Résultats consignés ci-dessous après exécution ciblée (un worker).

- `npm run build:types` : PASS (`tsc --noEmit`, aucun build de distribution).
- Premier `npx vitest run tests/streamcockpit3-mixer*.test.ts --maxWorkers=1` : échec de démarrage `EROFS` sur le cache Vite du `node_modules` partagé ; aucun test exécuté par cette tentative.
- Relance sans écriture de cache partagé : `node node_modules/vitest/vitest.mjs run tests/streamcockpit3-mixer*.test.ts --maxWorkers=1 --configLoader runner --no-cache`.

La table est une vue à rafraîchissement injecté, sans polling autonome. L'hôte devra rafraîchir/invalider la vue à la perte de connexion et à l'expiration des preuves ; la fraîcheur est évaluée à chaque lecture par le cœur.

Résultat de la relance : **19 tests PASS, 0 FAIL, 2 fichiers**, durée 70,76 s ; un worker simultané (deux workers isolés successifs). Couverture synthétique uniquement, aucune qualification matérielle.
