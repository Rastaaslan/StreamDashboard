# Smoke test avec comptes réels

À exécuter manuellement avec des comptes de test, jamais en CI.

1. Importer un client Desktop Google et saisir un Client ID public Twitch ; vérifier qu'aucun token n'apparaît dans logs, DevTools, SQLite ou `localStorage`.
2. Connecter Google (navigateur + loopback) et Twitch (device code), puis relancer l'application pour vérifier le coffre.
3. Créer un LIVE Google+Twitch ; vérifier ID privé Google, segment Twitch, titre/catégorie et statuts.
4. Modifier horaire et catégorie, puis désactiver chaque fournisseur en choisissant la suppression distante.
5. Créer un PERSONAL Google only ; activer Twitch et confirmer que la description privée n'est pas publiée.
6. Créer deux créneaux superposés, forcer puis modifier l'heure : la confirmation doit être redemandée.
7. Couper le réseau, créer/modifier/supprimer, vérifier les erreurs persistées puis les retries individuels.
8. Révoquer chaque autorisation et vérifier `REAUTH_REQUIRED` après un unique refresh/replay.
9. Simuler un timeout Twitch après POST : vérifier la récupération de l'ID sans second POST ; avec deux correspondances, vérifier l'arrêt en erreur.
10. Exécuter create/get/update/delete Google et Twitch puis nettoyer tous les objets distants.

Consigner version Windows, version de l'application, heures UTC/locales et résultats, sans copier de jetons.
