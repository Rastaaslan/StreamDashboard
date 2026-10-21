# Découverte locale Windows et Android

L’association propose une recherche explicite sur le réseau local. Les agents Windows et Android répondent pendant que leur partage HTTPS est actif. Ils annoncent uniquement leur identité publique, leur nom, leur plateforme et leur port. Le contrôleur construit l’adresse à partir de l’adresse source reçue ; aucun lien arbitraire, jeton ni empreinte de confiance n’est accepté dans l’annonce.

La sélection remplit l’adresse du formulaire. Le code d’association et la vérification de l’empreinte sur l’appareil cible restent requis. Les noms reçus sont échappés et les réponses tardives ne remplacent pas un autre dialogue. La saisie d’adresse et les liens d’association restent disponibles si le réseau invité, le pare-feu ou une autre instance empêche la découverte.

Le protocole UDP IPv4 utilise le port 48137, un nonce aléatoire par recherche et des datagrammes bornés. Les réponses sont plus petites que les requêtes. Les récepteurs ne répondent qu’aux adresses privées, avec limitation par adresse et mémoire bornée. Une recherche dure environ deux secondes ; elle ne lance aucune commande et n’associe aucun appareil automatiquement. Aucun changement de pare-feu n’est effectué par cette fonctionnalité.

Validation : test UDP réel sur loopback isolé, nonces invalides, adresses publiques et ports invalides ; parcours navigateur refusant un nom injecté et une adresse usurpée ; compilation, lint, tests JVM et APK Android. Les essais sur Windows et téléphone dans les réseaux domestiques réels restent à effectuer.

La vérification du redémarrage a également révélé que la normalisation de `dashboard.json` perdait le champ `permissions`. Il est désormais conservé et validé. Un essai arrêt/redémarrage du serveur vérifie les permissions limitées et les permissions vides avant toute commande. Les anciennes associations RC11.7 conservent leur distinction entre pilotage et gestion ; un champ de permissions invalide ne peut pas être interprété comme une association ancienne sans restriction.
