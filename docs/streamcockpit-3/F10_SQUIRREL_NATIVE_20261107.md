# F10 — raccordement natif Windows/Squirrel, 7 novembre 2026

Périmètre : dernier raccordement Squirrel de Cockpit 3.0, sur FIXE et la branche streamcockpit/3.0-full-experience. Base bb7c6d6766ae7fa11b5e4e0c5babf1d62a42f328. Aucun changement de Director, de fonctionnalités 3.1/V4 ou d'installation utilisée.

## Comportement raccordé

Le menu natif et le choix explicite de mise à jour utilisent le même contrat signé, le helper externe et le journal SQLite déjà en place. Le lanceur vérifie que le format détecté correspond au format signé : un contrat portable n'est jamais accepté pour une installation Squirrel.

Une image Squirrel porte dans son inventaire signé le packageId, les versions NuGet avant/après, le nom et les SHA-256/SHA-1/taille du paquet FULL, ainsi que l'empreinte de la bibliothèque Update.exe existante. Le SHA-1 sert à la compatibilité RELEASES ; l'autorité reste la signature Ed25519 de l'inventaire complet et Authenticode avec sa politique publique indépendante. Aucun nouveau certificat, clé ou accès de confiance n'est créé par le produit.

Le staging construit un feed exclusivement local, avec un seul paquet FULL authentifié et un fichier RELEASES déterministe. Une copie authentifiée de l'updater est chargée hors de l'installation, sous SquirrelApi.exe, pour permettre à Squirrel de mettre à jour son Update.exe actif. Le pont .NET vérifie les identités et utilise CheckForUpdate(ignoreDeltaUpdates=true), DownloadReleases et ApplyReleases directement. Il ne passe pas par la boucle de réessai Update.exe --update, FullInstall, KillAllProcesses ni un redémarrage de l'application.

La fermeture normale de l'ancien Desktop, l'observation indépendante FIXE, l'autorité appairée pour les clients et les inspections Windows existantes restent exigées. Pour Squirrel, l'exclusion couvre la racine d'installation entière, donc toutes les versions, le stub stable et Update.exe. Les hooks Squirrel sont traités par l'entrée existante avant ouverture du profil.

## Sauvegarde et récupération

Avant l'effet natif, une seule sauvegarde complète de l'installation Squirrel conserve Update.exe, le stub, les packages/RELEASES et les versions déjà présentes. backupPackage désigne l'ancien app-version à l'intérieur de cette sauvegarde ; aucune deuxième copie applicative identique n'est ajoutée. Le profil et les reçus restent protégés par la sauvegarde et les migrations existantes.

L'inscription de désinstallation HKCU et les raccourcis associés Desktop/StartMenu/barre des tâches sont capturés séparément. Le retour arrière explicite restaure l'arbre natif, le profil, les valeurs/types de cette inscription et les octets des raccourcis. Il ne demande pas à Squirrel d'effectuer un downgrade. Les états postérieurs modifiés, notamment de nouveaux reçus SQLite ou un raccourci changé par l'utilisateur, empêchent de remplacer silencieusement ces données.

Chaque effet garde son intention durable. Une interruption partielle, un processus natif en échec ou un résultat non confirmé reste pending ; une nouvelle demande ne rejoue pas l'effet. La relecture peut acquitter uniquement un résultat entièrement vérifié déjà présent. Les anciens arbres déplacés et les preuves sont conservés pour récupération manuelle.

## Contrat de préparation

Le format existant PreparedMaintenanceRequest est conservé. Pour le format Squirrel :

- image.squirrel décrit le paquet FULL signé et l'updater ; le contenu est inclus par directoryReleaseImageHash et directoryReleaseSigningPayload.
- options.squirrel.sourceFeed contient le paquet FULL désigné, déjà téléchargé.
- options.squirrel.backupInstallation est un nouveau dossier externe à l'installation et au profil.
- packageRoot est le véritable app-<version NuGet initiale> ; backupPackage est backupInstallation/app-<même version>.
- sourcePackage/image.packageFiles représentent les fichiers réellement extraits dans le nouvel app-version, dont squirrel.exe et le helper Cockpit. Le stub _ExecutionStub déplacé à la racine par Squirrel ne fait pas partie de cet inventaire applicatif.
- L'identité de la nouvelle image, son ancien état, le profil et la politique publique proviennent du parcours de préparation existant. Aucune empreinte d'un dossier arbitraire ne vaut approbation.
- Les titres/sociétés et métadonnées de raccourcis doivent rester compatibles ; un changement nécessitant une migration distincte est refusé.

Le chemin natif vise les installations Squirrel par utilisateur du maker existant et les deux noms de version explicitement liés au manifeste. Une inscription absente, un autre dossier, des liens non vérifiables, une bibliothèque différente ou une confiance indisponible empêchent l'admission.

## Qualification

La preuve logicielle consolidée est consignée dans evidence/F10-SQUIRREL-20261107/software-validation.json.

Les essais de transaction utilisent de vrais fichiers et SQLite temporaires avec effets natifs simulés pour injecter les interruptions. Les essais natifs exécutent réellement la bibliothèque Squirrel fournie par electron-winstaller, des paquets NuGet valides, la copie/extraction, l'inscription Windows QA et la restauration complète. Un exécutable console inoffensif remplace l'application : ses hooks ne peuvent pas ouvrir de comptes, de serveur, d'OBS ou de fournisseur.

Chaque installation QA utilise un packageId SC3QA_<aléatoire> et une inscription HKCU qui lui est propre ; elle est supprimée après le test. Les métadonnées PE et empreintes sont lues par le vrai vérificateur Windows. Seule la réponse positive de confiance du certificat est simulée ; le refus réel d'un fichier non signé reste testé séparément. Aucun certificat n'est généré/importé et aucune signature de production n'est revendiquée.

Les contrôles de régression, types, sécurité et bundle accompagnent ces essais. Les premiers échecs de fixture et de pont natif sont conservés dans les journaux locaux, puis corrigés ; les campagnes répétées ne sont pas additionnées.

## Livraison et gates

Ce raccordement est une modification de source. Les anciens manifests et la paire QA bb7c6d6 restent historiques et inchangés : ils ne contiennent pas ce code. Aucune installation réelle ou publication n'est effectuée ici.

F10 reste partiel pour la réception et les signatures de production ; G2 reste in_progress et G3/G4/G5 open. La réception réelle FIXE/laptop/Android, les politiques de signature compatibles, les fournisseurs, la migration/récupération sur les installations cibles et l'acceptation de Dam restent à qualifier.

Références de l'intégration : [API Electron](https://www.electronjs.org/docs/latest/api/auto-updater), [API Squirrel UpdateManager](https://github.com/Squirrel/Squirrel.Windows/blob/develop/src/Squirrel/UpdateManager.cs), [étapes Squirrel](https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/using/update-process.md). Le pont prend en charge la bibliothèque authentifiée effectivement présente ; il ne charge pas une DLL arbitraire fournie par un renderer.
