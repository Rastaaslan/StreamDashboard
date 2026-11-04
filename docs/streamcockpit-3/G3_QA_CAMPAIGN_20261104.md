# StreamCockpit 3.0 — campagne G3 du 04/11/2026, contrôles réels et simulations séparées

## Version et protocole
- Régies QA Windows réellement ouvertes sur FIXE et laptop : commit embarqué `a38305fd0e2548043bfca772942ea26565c7dec9` (le HEAD de développement a avancé séparément). Android utilisé/validé manuellement par Dam lors de la checklist.
- Les tests de pannes isolés ont été exécutés sur le HEAD `e6afd67bf28bf8c979c80bee6b24e0fab2ab6998` ; ils **ne qualifient pas rétroactivement le code plus ancien installé**. Source testée et provenance de l'app active doivent rester distinctes.
- OBS utilisateur : connecté, streamingKnown=true, streaming=false, recording=false, minuteur arrêté, aucune sortie de diffusion native ou Aitum active. Le replay buffer pouvait rester actif. Aucun test n'a lancé de live, d'enregistrement ou d'action publique Twitch.

## G3-01 — vrai FIXE + vrai laptop, Android confirmé par l'opérateur — PASS
- Identité logique du maître comparée sans divulguer le device ID : SHA256 préfixe 24 hex identique `F2A8C3F0A419B75CF94288FF` entre le descriptor local FIXE et le master de la topologie laptop.
- FIXE a seul le rôle `obs-executor` ; laptop ne l'a pas. Laptop routes `obs`, `clips`, `planning`, `cloud` vers ce même maître ; URL `https://192.168.1.15:48136` et HTTPS `/api/v1/health` répond HTTP 200. Aucune horloge/OBS local concurrent sur laptop.
- Appairage Android et contrôle des commandes confirmés par Dam ; FIXE indique aussi `Mon téléphone` appairé avec présence récente lors des contrôles précédents. Pas d'accès direct au téléphone.

## G3-04 — redémarrage réel de l'application QA FIXE — PASS
- Procédure avec préflight (OBS connecté, ni live ni recording, timer arrêté, aucun reçu in-flight, aucune sortie stream active), fermeture gracieuse **uniquement** de l'EXE `a38305f` puis redémarrage même EXE/profil avec `NODE_ENV=test`.
- Preuve horodatée `out/sc3-g3/20261104-operator-verified/g3-04-qa-restart.json` : de `2026-11-04T12:17:19Z` à `12:17:22Z`, scène `JEU`, **54 événements**, **39 reçus**, zéro en attente, Google/Twitch connectés, TLS actif, replay actif et état du minuteur 300 s arrêté conservés. OBS jamais fermé ; pas de replay de commandes OBS/Twitch observé. Laptop HTTPS santé 200 après reprise.
- Un redémarrage **gracieux** de la QA ne prouve pas un crash forcé ni une panne électrique ; cette distinction est maintenue.

## G3-05, G3-08, G3-10 — tests sur processus isolés, PASS synthétique seulement
- Suite Microsoft Windows `tests/streamcockpit3-agent-fencing.test.ts` (**16 PASS**) : rejet après perte de connexion OBS, refus des RPC tardifs, réservation durable, scénario d'accusé de commande perdu, refus de répétition après reprise, processus enfant réellement interrompu entre réservation et effet, conservation du verrou/indice et refus de reprise aveugle.
- Suite `tests/agent-v2-simulated-obs-execution.test.ts` (**14 PASS**) : serveur WebSocket OBS factice sur port éphémère et identité d'attestation propre à l'essai, aucun appel au véritable OBS. Vérification de l'état incertain lors d'une réponse perdue, sans deuxième commande ; verrou d'autorité et journal conservés.
- Suite `tests/agent-v2-reservation.test.ts` (**3 PASS**) : refus des doublons et des acteurs/destinations non autorisés.
- Suite `tests/streamcockpit3-agent-headless-process.test.ts` (**1 PASS**) : vrai processus Node Windows isolé, DPAPI/mTLS réels avec certificats éphémères de **test**, OBS synthétique, arrêt/reprise de l'Agent, fraîcheur de l'état, perte de connexion et non-répétition persistante.
- Total **34 PASS / 0 FAIL / 0 skipped**, résultats archivés `out/sc3-g3/20261104-operator-verified/g3-failure-resilience-vitest.log`. OpenSSL installé avec Git a été ajouté uniquement au PATH du processus de test. Aucun secret ni jeton utilisateur n'a été exporté.
- Ces simulations **ne sont pas le test de fermeture du vrai OBS**, ni une perte d'ACK commandée sur Android en direct, ni un crash de la véritable QA reliée au matériel. Les scénarios G3-05/08/10 restent donc en attente de réception matérielle si le critère initial est maintenu.

## Autres scénarios G3 — déjà confirmés par Dam
- G3-02 : minuteur identique sur FIXE/laptop/Android ; G3-03 : Wi-Fi Android coupé/reconnecté sans replay ; G3-06 : planning Google identique sur les trois ; G3-07 : commande de scène depuis Android ; G3-09 : audio/Spotify VOD mesurés/écoutés. Ces résultats proviennent de la checklist explicitement cochée par l'opérateur le 04/11 et demeurent distingués des traces générées par les tests automatiques.

## Statut
- G3-01 et G3-04 disposent d'une vérification matérielle complémentaire sur les PC et d'une preuve de reprise QA. Les six validations opérateur sont respectées.
- G3-05, G3-08 et G3-10 ne disposent que de tests isolés/synthétiques ; il serait inexact de les déclarer certifiés sur le trio. **G3 reste ouvert** jusqu'à preuve des scénarios matériels et analyse du processus réellement livré.
- G4 signatures de production et rollback RC2→V3, et G5 acceptation finale, restent distincts de cette campagne. Rien n'a été publié ou installé sur Android durant l'opération.
