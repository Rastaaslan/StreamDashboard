# F04 — Laboratoire ClipForge Windows / FFmpeg (2026-11-02)

## Portée réelle
Machine de développement : FIXE Windows 11 uniquement, branche `streamcockpit/3.0-full-experience`. Le code `apps/server/src/streamcockpit-clipforge-windows.ts` est **isolé** : aucune route HTTP, aucun bouton Android/Desktop, aucun lancement automatique de fournisseur/OBS et aucun changement du pipeline Linux. Il exige explicitement `I_ACCEPT_WINDOWS_CLIPFORGE_OFFLINE_LAB` et un chemin absolu vers les binaires FFmpeg/FFprobe **provisionnés par l'hôte**. Il ne doit pas servir de contrat de livraison/production.

## Fonction démontrée
Sur FIXE (NTFS), un fichier vidéo **synthétique** créé localement par FFmpeg a été transcodé en MP4 vertical **360 × 640 / 1 seconde** par un processus sans shell et mono-thread. FFprobe contrôle dimensions et durée ; le manifest JSON contient empreintes SHA-256 entrée/sortie, mesures, géométrie et noms relatifs uniquement ; VTT de sous-titrage écrit séparément. Pas de vidéo OBS, replay utilisateur, API distante ni clé de compte manipulés.

Le processus utilise un cliché local privé (copie depuis un descripteur ouvert, taille/empreinte/nlink/mtime/ctime recontrôlés), des chemins locaux absolus sans jonction/symlink, ni destination dans la source, ni réseau FFmpeg. La demande est réservée sous `jobId.intent` **avant** encodage : aucun remplacement d'un fichier existant, collision = `UNKNOWN`, jamais de retry aveugle. Sortie copiée avec `COPYFILE_EXCL`, fichier final synchronisé via poignée en lecture/écriture NTFS (ouvrir en lecture seule causait EPERM), métriques et empreinte recontrôlées, manifest écrit en dernier. Un travail réussi supprime uniquement son staging temporaire propriétaire ; un travail incertain laisse l'intent/staging en l'état pour inspection manuelle.

## Preuves du passage
- `tests/streamcockpit3-clipforge-windows-lab.test.ts` avec `SC3_CLIPFORGE_WINDOWS_LAB_TEST=1` et FFmpeg/FFprobe existants : **9/9 PASS**, incluant le vrai codec, HMAC inexistant (seul SHA-256 de fichier autorisé), refus de mauvaise empreinte/segment, jonction NTFS, source à liens multiples, racines imbriquées, collision d'export, deux prétendants concurrents, abort préalable, absence d'écrasement et suppression du staging sur succès.
- Régression de quatre suites (ClipForge Windows lab, pipeline Linux/pure, exécuteur Linux/pure et matrice) : **28 PASS / 42 skipped / 0 FAIL**. Les 42 skips sont des protections POSIX/Linux **non qualifiées sur Windows**, pas une preuve pour le backend Windows.
- `npm run build:types` **PASS** et `npm run security:check` **PASS** (824 fichiers) sur le worktree incluant des modifications isolées F08 d'un autre propriétaire ; aucun test global n'est pour autant automatiquement acquis.
- Au premier essai un échec de synchronisation `FlushFileBuffers` avec descripteur en lecture seule NTFS a été reproduit et corrigé. Les essais initialement échoués sont conservés dans la continuité factuelle ; les derniers tests cités sont verts.

## Gates strictement ouverts
**F04 reste PARTIAL ; G2 en cours ; G3–G5 ouverts.** Le laboratoire ne fournit pas encore :
- de **Windows Job Object** kill-on-close + plafonds effectifs CPU/mémoire/espace disque, ni des ACL de répertoire staging qualifiées contre un processus local adversarial ;
- de preuve de durabilité de l'intent/manifest en coupure électrique NTFS, ni d'atomicité de finalisation au sens matériel ;
- de liaison sûre avec un vrai fichier replay OBS via identité durable, ni d'encodage de replays Minecraft utilisateurs, ni de confirmation Android/FFmpeg sous charge de stream ;
- de service API/UX avec permissions authentifiées, confirmation explicite, rollback/migration validés ; ni d'artefacts signés Windows + APK identiques.

La priorité suivante est l'isolation Windows + durabilité et la source OBS effectivement autorisée. **Ne pas monter ce laboratoire en production, ne pas publier de RC et ne pas traiter les tests Linux skipped comme validés.**

## Addendum FIXE ~07:50 CET — transaction et autorisation de l'entrée
Dans le laboratoire Windows isolé, le `SourceGrant` et la demande `ClipSegment` sont maintenant **capturés synchroniquement avant le premier accès disque asynchrone**. Une mutation ultérieure de l'objet partagé par l'appelant ne peut plus remplacer `relativePath`, SHA-256, paramètres de coupe ni légendes. Le test de non-régression essaie explicitement d'injecter `../outside.mp4` et de changer l'empreinte et la durée pendant `lstat/realpath` ; l'export réel FFmpeg reste lié au fichier et au segment initialement autorisés.

La création exclusive de `.intent` a un nouvel état intermédiaire `reservationAttempted` : si une erreur se produit après une tentative de création (y compris erreur possible de `FlushFileBuffers` NTFS), elle est rapportée **UNKNOWN**, sans réessai et sans suppression du staging. Un `EEXIST` connu garde le contrat `EXISTING_JOB` et nettoie seulement le staging du prétendant perdant. Le test d'échec de code retour de l'encodeur utilise un vrai exécutable PE FFprobe sous le nom privé `ffmpeg.exe` et vérifie conservation de l'intent/staging et absence de deuxième encodage. Cela **ne constitue pas** une preuve de durabilité électrique ou de confinement Windows Job Object.

Résultat local du lot : **11/11 PASS** sur FIXE avec FFmpeg/FFprobe WinGet réellement exécutés (9 précédents + 2 cas de sécurité), puis `build:types` PASS, `check:browser-types` PASS, `security:check` PASS (827 fichiers dans l'arbre comprenant aussi le F08 non committé d'un autre propriétaire), `git diff --check` PASS. Aucun test matériel OBS/Android ni build installable. F04 reste `partial` et G2 `in_progress`, G3–G5 `open`. Le code reste inaccessible aux routes de production.

Revalidation de régression **après** ces deux corrections : quatre suites ClipForge+roadmap sur FIXE avec option laboratoire explicite : **30 PASS / 42 skipped / 0 FAIL** (72 cas, exit 0). Les 42 skips concernent notamment le comportement POSIX/Linux et ne constituent pas une preuve d'exécution Windows.
