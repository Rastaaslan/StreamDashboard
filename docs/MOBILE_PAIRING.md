# Pairing mobile

Dans **Settings/Réglages**, générer un code/QR valable cinq minutes. Scanner le QR sur le même réseau : le mobile échange une seule fois le code contre un identifiant et un token aléatoire de 256 bits. Le navigateur garde ces deux valeurs; le serveur ne conserve que le hash SHA-256 du token.

Les mutations envoient `X-Device-Id` et `Authorization: Bearer …`. Le WebSocket transmet ces données à la connexion, se reconnecte automatiquement et reçoit le même état que le desktop. La liste des appareils et `DELETE /api/devices/:id` permettent la révocation. Utiliser HTTPS/WSS via un reverse proxy hors d'un LAN de confiance.
