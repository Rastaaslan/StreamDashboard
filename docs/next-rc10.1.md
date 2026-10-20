# StreamDashboard Next — RC10.1 Android

Google Agenda et YouTube peuvent utiliser deux adresses différentes, ou la même adresse au choix.

## Fonctionnement

- Chaque bouton Connecter / Changer de compte ouvre le sélecteur natif Google pour le service concerné.
- Agenda et YouTube ont leurs propres sessions, comptes sauvegardés, diagnostics et déconnexions.
- Les requêtes et le renouvellement demandent explicitement le compte choisi, sans dépendre du compte Google par défaut du téléphone.
- Agenda demande uniquement ses permissions Calendar ; YouTube demande sa permission de consultation de chaîne. La gestion du live reste sur la régie.
- L’adresse sélectionnée est visible dans Mes comptes. Vérifier YouTube affiche aussi le nom de la chaîne réellement renvoyée par Google.
- Une annulation ou un refus lors d’un changement de compte conserve la session précédente. La déconnexion d’un service ne déconnecte pas l’autre.
- Les tokens restent natifs ; le compte et les permissions sont conservés dans le stockage chiffré Android. Les sauvegardes, données et plannings locaux restent en place.

## Installation et migration

Installer cet APK par-dessus StreamDashboard Next, sans désinstaller. Version `2.0.0-rc.10.1`, code `2000013`.

Les anciennes versions conservaient des autorisations partagées sans identité de compte. Au premier démarrage de cette version, sélectionner à nouveau une fois le compte d’Agenda, puis celui de YouTube dans **Mes comptes**. Cette sélection explicite évite de rattacher silencieusement un service au mauvais compte. Les connexions suivantes sont rétablies séparément.

Le client OAuth Android est commun aux deux comptes, dans le même projet Google Cloud :

- Package : `com.rastaaslan.streamdashboard.remote.next`
- SHA-1 : `E2:F2:1F:4C:28:79:DE:33:B8:85:A4:54:8B:DF:D5:A2:21:2B:1B:1F`

Le client de l’ancienne application doit être conservé. Les comptes sont sélectionnés sur le téléphone, ils ne sont pas codés dans l’APK.

## Validation

Tests ciblés : comptes et tokens distincts, renouvellement explicite, restauration de deux comptes, déconnexions indépendantes, conservation après annulation/refus, refus d’un changement de compte au renouvellement, résultats tardifs ignorés, absence de fusion des permissions, routage du bridge natif et affichage des deux cartes.

L’autorisation Google réelle de la RC9.2 a été confirmée par Damien après ajout du client Android correspondant. Le choix de deux comptes dans cette nouvelle version et la réponse réelle de sa chaîne YouTube restent à valider sur le S24 Ultra. Aucun live ni message public n’a été déclenché.

Références :
- https://developers.google.com/android/reference/com/google/android/gms/auth/api/identity/AuthorizationRequest.Builder
- https://developers.google.com/android/reference/com/google/android/gms/common/AccountPicker
