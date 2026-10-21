# Adoption du planning par Android

Le récepteur Android accepte désormais le contrat `planningTransfer` déjà utilisé pour transmettre les créations autonomes à Windows. Il reprend les événements avec leurs identités Twitch et Google, comptes propriétaires, calendriers, révisions et journaux de publication. L’adoption n’appelle aucun fournisseur et ne recrée aucune publication.

La source conserve son événement en lecture seule et enregistre la modification sortante dans une transaction IndexedDB. La destination écrit l’événement et son reçu ensemble, sous le verrou du moteur de planning. Une réponse perdue peut être vérifiée sans répéter l’adoption. Une identité déjà présente, une publication incertaine ou une permission retirée empêchent l’adoption ; aucune version n’est écrasée.

Les comptes restent propres à chaque appareil. Le transfert ne connecte pas les fournisseurs sur la destination ; leurs contrôles de compte et de calendrier continuent de s’appliquer aux modifications ultérieures.

Les essais `tests/planning-transfer-ui.spec.ts` utilisent IndexedDB et Web Locks dans Chromium, avec des fournisseurs qui échouent si un appel est tenté pendant l’adoption. Ils couvrent le passage source → copie sortante → récepteur Android, les reçus après redémarrage du synchroniseur, le conflit d’identité, la création incertaine et la révocation durant l’attente du verrou.

Cette adoption ne constitue pas encore le déplacement complet de toutes les responsabilités d’une installation. Les transferts inverses depuis un espace serveur, la restauration distribuée des rôles et les essais matériels restent à terminer.
