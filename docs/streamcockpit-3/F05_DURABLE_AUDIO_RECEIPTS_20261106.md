# F05 — Reçus audio durables, récupération et retour manuel après redémarrage

06/11/2026 — FIXE exclusivement via RDC. Base `fd7683a6fe2c088e085367d56d6446ec43136b09`, branche/origin canoniques. PLAN, matrice, CONTINUITY, MIGRATION et audit final relus ; propriété déclarée dans `.git/sc3-cdc-completion-owner.json`. Les trois fichiers UI mixeur déjà modifiés, leur test navigateur et CONTINUITY sont préservés octet pour octet. Aucun profil/installation, appareil tiers ou compte réel accédé.

## Raccordement fonctionnel
Le routeur gain/muet conservait seulement ses reçus complets en mémoire : après redémarrage, une commande pourtant confirmée devenait indéfiniment incertaine. `AudioReceiptSqlite` conserve maintenant une réservation avant toute écriture OBS, puis le résultat exact après relecture. Le routeur de production est raccordé à ce journal via `HostWindowsDurableJournals.audioReceipts()`, protégé par le même contrôle de maintenance que les autres journaux. L'ancien mécanisme de réservation demeure en place ; ses réservations historiques sans reçu complet restent honnêtement incertaines.

- Relecture par identifiant et historique GET paginé (100 entrées) sous les permissions observe/OBS/audio, limités au contrôleur authentifié et à l'identité stable de FIXE. Pas d'exposition des clés de contexte, secrets ou chemins. L'historique est factuel : il ne prouve pas que le réglage courant est resté identique.
- Réservation et fin de commande en transactions SQLite DELETE/EXTRA ; contrôle du format, de l'intégrité et de la portée. Aucune purge des tentatives inconnues ni réécriture d'un résultat terminal. Limite 10 000 entrées : nouvelle admission refusée, pas d'effacement silencieux. Une erreur d'écriture bloque les écritures suivantes de l'instance.
- Un acquittement HTTP perdu peut être récupéré après redémarrage du routeur sans nouvel envoi OBS. Un acquittement local de COMMIT perdu se réconcilie par lecture vérifiée, pas par réexécution. Une réservation sans résultat demeure incertaine, sans droit de rollback.
- Un reçu confirmé récupéré permet un NOUVEL aperçu de retour manuel : même identité FIXE, même UUID de source, gain et muet toujours égaux à l'état après commande ; la nouvelle confirmation est liée à l'observation et à la génération actuelles. Cela n'affirme pas une continuité de génération OBS à travers le redémarrage. Une source remplacée, valeur modifiée ou permission retirée refuse le retour.
- Le remplacement/rollback F10 refuse désormais la suppression, modification ou présence d'annexes transactionnelles du journal `streamcockpit-mixer-receipts.sqlite`, même si un inventaire cible les déclarait.

## Preuves
**13 suites / 161 PASS / 0 FAIL / 0 skipped**, dont **35 nouveaux tests** : `.git/sc3-audio-receipts-final.json` et `.git/sc3-audio-receipts-final.log`. SQLite et filesystem Windows réels sur données temporaires ; deux scénarios dans des processus enfants indépendants avec sortie abrupte. Routes HTTP, bus de commandes et client OBS réels, serveur OBS WebSocket exclusivement synthétique/loopback.

Deux parcours Edge 320 px : régression existante et nouveau parcours avec UI **lue depuis HEAD Git** pour ne pas dépendre du correctif UI concurrent. Ce dernier simule la perte de l'ACK HTTP, redémarre le routeur, recharge la page, retrouve le reçu confirmé puis effectue un rollback à consentement neuf ; aucun POST automatique à la récupération. La régression navigateur existante utilise le working tree et ne qualifie pas le patch UI d'autrui. Première suite : 51 PASS/1 FAIL, erreur de nom de méthode dans le nouveau test de maintenance, corrigée sans supprimer d'assertion.

`build:types`, `check:browser-types`, `security:check` (6 826 fichiers) et `git diff --check` : PASS, codes 0. Un worker, priorité basse ; aucun build global/package, déploiement, signature ou commande OBS/Twitch de production. Les nouveaux tests de migration F10 refusent explicitement toute perte du journal audio.

## Limites et suite
Les reçus complets antérieurs à ce lot ne peuvent pas être reconstruits à partir d'une simple réservation. Aucun test de panne électrique, de périphérique réel, de routage PC jeu/VOD ou de migration d'un profil installé. La liste historique complète est exposée par API ; l'interface actuelle sait récupérer un reçu en attente, mais n'a pas encore de vue de navigation de tout l'historique. L'UI mixeur concurrente n'est ni modifiée ni intégrée. F05 reste partial, G2 in_progress et G3–G5 open.

Prochaines clôtures utiles : vue d'historique/routage F05 quand les fichiers UI sont libérés ; installation native F10 et attestations Windows réelles, sans toucher à la version en usage.
