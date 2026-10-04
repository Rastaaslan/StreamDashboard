# Suppression du Planning par période

Depuis Planning, « Supprimer une période » ouvre un dialogue début/fin (heures locales du navigateur, envoyées en UTC). Seuls les événements locaux entièrement compris dans cette plage sont supprimés. Un événement qui chevauche une limite est exclu. Les séries, occurrences, séries Twitch et liens Google à occurrences sont protégés et doivent être traités individuellement. L’aperçu liste aussi les séries protégées, même lorsque leur première occurrence précède la plage.

La suppression est locale par défaut. Twitch et Google sont deux choix explicites supplémentaires. Modifier la période ou les destinations invalide l’aperçu et la confirmation. Les erreurs sont affichées par événement ; un nouvel aperçu permet de réessayer les éléments conservés.

API (POST, `/api/v1`, également `/api`) :

- `/planning/bulk-delete/preview` : `{ start, end, destinations?: { twitch, google } }`. Renvoie un jeton valable dix minutes, le nombre, les entrées et les exclusions.
- `/planning/bulk-delete/confirm` : `{ token, confirm: true }`. Renvoie `{ deleted, failed }`. Le jeton est à usage unique et lié au contenu canonique et aux destinations. Un changement du contenu sélectionné impose un nouvel aperçu.

Les opérations passent par la file du Planning. Chaque événement est traité indépendamment ; le retrait local et son tombstone compagnon sont écrits ensemble. Un échec distant conserve l’événement, les identifiants distants et l’intention de retrait pour réessayer. Les créations incertaines et le travail compagnon en attente sont exclus. Les copies distantes sont relues avant suppression : un déplacement hors période ou une récurrence entraîne un refus. Google exige la version distante (ETag) et utilise `If-Match`. Twitch ne fournit pas de suppression conditionnelle ; sa vérification précède immédiatement la suppression. Les protections restent best-effort face aux modifications concurrentes côté Twitch.

La période confirmée est persistée dans `ProviderLink.deletionPeriod` avant le retrait. Les adaptateurs partagés relisent et valident la copie distante avec cette période pour chaque tentative, y compris le retry standard et le retrait déclenché par une modification ordinaire, après redémarrage également. Un refus conserve ces contraintes et les identifiants ; seul un nouvel aperçu confirmé peut remplacer la période. Après un retrait distant réussi, la contrainte du lien est effacée. Le retry standard conserve l’événement local : un nouvel aperçu permet ensuite de terminer sa suppression locale.
