# Intégration du moteur de tags

Le serveur branche par défaut le moteur local déterministe CB-100
(`packages/core/src/twitch-tags.ts`) à l’adaptateur `localTagEngine`.
Aucune API externe, clé ou dépendance supplémentaire n’est utilisée.
`DashboardServerOptions.tagEngine` reste injectable pour tester les erreurs et
le délai maximal. La normalisation des tags manuels conserve leur graphie Unicode,
déduplique accents/casse et impose 10 tags de 25 caractères maximum.

Entrée : titre, description, ID/nom de catégorie Twitch et préférences
`automatic` (vrai par défaut), `language` (facultative). Le moteur reçoit un
`AbortSignal` ; le délai maximal côté Dashboard est de 1,5 seconde.

Chaque événement conserve `tags: { values, source, generatedAt? }` et
`tagPreferences`. Les anciens événements restent compatibles. Planning permet
de voir/modifier les tags et de régénérer sans sauvegarde implicite ; la copie
conserve ces métadonnées. Pour vider les tags sans génération, décocher la
génération automatique. Les tags saisis sont facultatifs.

`POST /api/v1/planning/tags/regenerate` reçoit ces champs d’événement et renvoie
`{ tags?, warning? }`. Sans moteur, sur erreur, résultat vide/invalide ou timeout,
les tags existants sont conservés. Cette route utilise les protections HTTP
existantes du serveur. Elle ne publie rien chez les fournisseurs.

Le preflight génère seulement les tags manquants si l’automatisation est active,
puis applique titre, catégorie et tags avec Helix Modify Channel Information.
Sans tags disponibles, il omet le champ (les tags Twitch restent intacts). Si
la requête avec tags est refusée, il réessaie titre/catégorie seuls et expose
`tagsWarning`, sans mettre le preflight en erreur pour les seuls tags. Une
panne indépendante de Twitch peut toujours mettre la préparation en erreur.
Les synchronisations Google et Twitch Schedule ne sont pas modifiées.
