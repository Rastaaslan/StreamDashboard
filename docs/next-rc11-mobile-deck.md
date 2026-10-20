# StreamDashboard Next RC11 — Deck mobile

Cette version rapproche l'application Android d'une surface Stream Deck : les
commandes occupent l'écran et les réglages restent accessibles dans Gestion.

## Utilisation

- **Mon Deck** s'ouvre sur une banque de favoris qui peut mélanger les boutons
  configurés et les sons de la bibliothèque.
- **Personnaliser** permet de sélectionner les favoris. Les pressions pendant
  cette sélection modifient les favoris sans déclencher les commandes.
- Les banques **Tout, Scènes, Alertes, Messages et WizeBot** donnent accès aux
  commandes existantes ; l'onglet **Sons** ouvre les catégories de la soundboard.
- Un bandeau fixe conserve les commandes **Micro, Clip et Stop son** à portée
  de main pendant le défilement. Lorsque le tampon OBS est inactif, le bouton
  de clip ouvre sa préparation.
- Le journal reste accessible sous les boutons. Les états affichés viennent
  des réponses de la régie ; une scène mémorisée hors connexion est identifiée
  comme le dernier état connu.

La présentation tactile fonctionne en portrait et en paysage dans l'application
Android. Sur un grand écran de PC, les pages Deck et Sons conservent leur
présentation habituelle. L'onglet Live conserve les commandes de diffusion.

## Préférences et commandes

Les favoris sont enregistrés sur l'appareil, séparément pour chaque espace,
sous `sd2.performance-deck.v1:<scope>`. Ils utilisent les identifiants réels
`action:<id>` et `sound:<id>`. Une liste volontairement vide est conservée.
La banque consultée pendant la personnalisation ne remplace pas la banque
habituelle. Le retour Android ferme d'abord un dialogue, puis la personnalisation,
puis revient au Deck.

Les boutons passent par le répartiteur de commandes existant. Le lancement et
l'arrêt du live sont exclus des pads. Les commandes restent suspendues hors
connexion ou en présence de réglages à synchroniser. Aucun appui hors connexion
n'est mis en attente pour une exécution ultérieure.

Le micro du bandeau utilise un bouton micro réellement configuré. Les boutons
WizeBot tiennent compte de la capacité d'envoi Twitch et les sons indisponibles
sont désactivés. Stop son peut interrompre une lecture connue pendant qu'une
autre commande attend sa réponse ; le compteur de commandes actives garde les
autres boutons bloqués jusqu'à la fin de toutes les requêtes en cours.

## Vérification

Le test de régression est découvert par la suite Node existante :

```bash
node --test tests/node/mobile-performance.test.mjs
```

Il couvre les favoris séparés par espace, les libellés échappés, les boutons
personnalisés, l'édition sans exécution, les gardes de connexion, le retour
Android et les ordres de résolution Micro/Stop son et Minuteur/Stop son. Il
exécute les fonctions du contrôleur avec des transports simulés, sans commande
sur une régie réelle.

La vérification visuelle utilise les fichiers de présentation livrés et un
catalogue synthétique. Les éléments de ce catalogue servent uniquement au
contrôle du rendu et ne sont pas ajoutés à la configuration de l'utilisateur.

## Application Android

- Version : `2.0.0-rc.11`.
- Version Android : `2000014`.
- Identifiant : `com.rastaaslan.streamdashboard.remote.next`.
- Base : RC10.1, commit `be8f252a39b6209e3421123dcff52b9ea7ccee44`.

La livraison utilise le certificat de RC10.1 pour permettre une mise à jour de
l'application existante. Les comptes Google Calendar et YouTube restent
indépendants. Le serveur utilisé pour compiler l'APK ne devient pas une
dépendance d'exécution de l'application.
