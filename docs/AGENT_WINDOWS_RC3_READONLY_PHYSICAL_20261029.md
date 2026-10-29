# Qualification physique FIXE — Agent read-only RC3 original

Le 29 octobre 2026, le ZIP Agent RC3 original de 39 363 octets a été qualifié dans
un nouveau dossier temporaire privé sur FIXE, avec Node v22.22.3 déjà disponible
et Windows PowerShell 5.1.26100.9711. Résultat : PASS, suivi d'un contrôle
final indépendant PASS. Aucun binaire RC3 n'a été reconstruit ou remplacé.

| Élément réellement testé | SHA-256 |
|---|---|
| ZIP Agent original, source 3d44f59 | 77848841f5f70d4e39f2d4c2f467796e3b453f0531e46db0c357c1c4273a8ee8 |
| StreamAgent-ReadOnly.mjs | 30bb58992676b28563a4bc4eb0ddfddad89aaa3bd38e39298b3c4c9cecb79b9a |
| Lanceur PowerShell | 19246d88dded9d2c30eb5a183cbc6f381ac157648a382b4e5bd3b66f56b5c400 |

La qualification vise ces octets RC3. Le bundle du port public 17afbcb, hash
4a3a889c99385962353cc8daf19c1e470f69e9563b3b0d240c137223e7b62e23,
n'a pas été lancé physiquement par ce banc. Le lanceur possède les mêmes octets.

## Vérifications exécutées

- PID, heures de démarrage et listeners OBS / sept processus Dashboard relevés
  avant le banc et comparés ensuite : inchangés.
- Certificats serveur/client factices générés en mémoire avec RSACng éphémère ;
  aucune importation dans un magasin Windows de certificats.
- Coffres DPAPI CurrentUser temporaires : secret factice aller-retour, corruption
  refusée, puis faux mot de passe du proxy et identités TLS chargés par le RC3.
- Mode once du bundle original connecté à OBS local 4555 : observation valide,
  sortie 0. Le secret OBS existant a été lu seulement en mémoire.
- Monitor via proxy WebSocket QA authentifié : seules GetStats et GetStreamStatus
  peuvent être transmises à OBS réel. Le broker a compté cinq appels de chaque
  méthode ; le once direct est observé séparément.
- Endpoint mTLS du monitor accessible avec l'identité factice protégée. Second
  lanceur refusé sans création d'un second Agent.
- Arrêt du seul proxy QA : lecture health indisponible, puis reprise de ce proxy
  et reconnexion du même Agent avec révision 1 → 2. OBS réel n'a pas été interrompu.
  Le client haut niveau a observé le refus ; le code HTTP brut n'a pas été capturé
  séparément dans cette passe.
- Terminaison volontaire du seul fils Agent QA, vérifié par PID, création et
  chemin : le lanceur l'a relancé et la santé est revenue. La nouvelle vie du
  processus repart à révision 1 ; aucune monotonie entre redémarrages n'est annoncée.
- Ctrl+C envoyé à la seule console privée créée pour le banc, après vérification
  exhaustive de ses deux membres QA : fils et lanceur terminés, sans fallback
  de terminaison forcée pour cet arrêt.
- Contrôle indépendant : verrou absent puis réacquisition exclusive réussie,
  aucun processus/listener QA, aucun dossier credential ou faux APPDATA restant.
  Aucune clé privée, fichier DPAPI, PEM/PFX/P12 restant dans le dossier QA.

OBS est resté inactif avant/après les lectures. Aucune méthode de mutation OBS
n'existe dans le proxy du banc. Aucun mot de passe réel n'a été copié dans un
artefact, une variable d'environnement ou un coffre QA ; aucune identité réelle
DPAPI n'a été exportée. Les sorties visibles ne contiennent aucun secret.

## Prévol et correction de mesure conservés

Le premier prévol CngKey.Create sous PowerShell a produit une clé non éphémère.
Le garde-fou l'a refusée avant toute connexion OBS. Cette seule clé factice a
été identifiée par son UniqueName exact et sa fenêtre de création puis supprimée
via son handle CNG. RSACng(2048), vérifié éphémère, a ensuite passé le prévol.
Le résultat rouge, le prévol corrigé et la preuve de nettoyage sont conservés.

Le flag brut lockReleased=false provenait d'une mesure qui cherchait un fichier
persistant après arrêt ; le lanceur le supprime dans finally. La preuve brute
reste inchangée. Le contrôle indépendant a confirmé l'absence du fichier, acquis
FileShare.None sur le même chemin, fermé le handle et supprimé son propre probe.

## Preuves et limites

Le manifeste voisin fournit les hashes des preuves complètes conservées localement
dans out/windows-physical-rc3-20261029, hors de la PR. Le dossier temporaire Windows
conserve seulement le paquet original, les scripts de banc et les rapports sans
secrets ; les fixtures et credentials factices ont été supprimés.

Controller Windows visuel, liaison entre deux PC, Android physique, écrivain OBS
réel, installation SCM/démarrage automatique et coupure électrique : NOT_RUN.
Les fixtures factices ne constituent pas un provisioning utilisateur. Cette passe
ne certifie pas un Dashboard NEXT complet. Les anciennes applications, profils,
services, pare-feu et paquets QA restent en place.

Ce commit contient seulement ces notes et leur manifeste. Le code du port Agent,
ses 75 tests ciblés et son build portable ne sont pas modifiés. Aucun push ni
déploiement n'est effectué par cette qualification.

## Inventaire Android après la qualification

ADB était déjà installé sur FIXE, avec son serveur préexistant. La commande
adb devices -l a réussi : aucun appareil connecté, autorisé, non autorisé ou
hors ligne. Le PID et l'heure de démarrage du serveur ADB sont restés inchangés.
Aucun logiciel installé, connexion initiée ou demande utilisateur. Laptop était
hors ligne dans l'inventaire Remote Desktop Commander. Android physique reste
NOT_RUN ; le banc n'attend pas une intervention utilisateur.

Le Controller Windows visuel reste NOT_RUN. Le prochain banc devra démontrer
avant tout lancement que les chemins de profil/configuration sont isolés, les
ports QA réservés et tous les adaptateurs mutateurs redirigés vers un faux OBS.
Le profil et l'application actifs ne doivent jamais être ouverts par ce banc.
Aucune instance Controller n'a été lancée pour cette préparation.
