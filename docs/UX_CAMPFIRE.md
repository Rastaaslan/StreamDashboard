# StreamDashboard UX 3.0 — console Campfire

## Rôles des clients

- **Mobile** est la télécommande immédiate : scène, micro, clip, pause, sons,
  chat, statut et planning léger.
- **Desktop** est la console de préparation, configuration et supervision :
  préparation, planning riche, OBS, connexions et diagnostics.

Les deux surfaces partagent le vocabulaire français, les états humains et la
sémantique Campfire Purple, sans partager leurs préférences visuelles locales.

## Principes UX

1. **Un écran = une intention.** Checklist, Notes et Templates sont des espaces
   exclusifs, pas trois blocs empilés.
2. **Une action primaire domine.** Les actions secondaires restent neutres et
   les actions destructives résident dans un menu contextuel.
3. **Mémoire musculaire.** Clip, Pause, Scènes et Micro ne changent jamais de
   position en fonction de l'usage.
4. **Divulgation progressive.** Les formulaires, outils Planning et réglages
   avancés restent fermés jusqu'à une demande explicite.
5. **Le violet signifie actif ou vivant.** La nuit reste charbon et prune ; la
   braise violette indique le focus, la sélection ou une action confirmée.

## Mobile

La navigation principale reste Accueil, Live, Sons et Planning. Le menu Le camp
contient Préparation, Stream, Connexions et Application. Focus est accessible
dans le header sur tous les écrans et reste synchronisé avec le réglage local.
Les préférences Focus, mouvement réduit et densité sont disponibles hors de la
zone réservée aux options natives Android.

Préparation propose trois onglets stables. Checklist est la destination par
défaut lors d'une préparation intentionnelle ; Notes et Templates conservent
leurs données et actions, mais ne sont jamais visibles simultanément.

## Desktop

La sidebar stable sépare travail principal, gestion et système. La barre haute
résume PC, OBS, Twitch et Live. Préparer utilise les mêmes trois intentions que
le mobile, Planning replie ses outils d'export/publication et Live garde ses
commandes essentielles séparées de la configuration avancée.

Le Focus desktop est local et indépendant du Focus mobile. Il masque les
surfaces secondaires sans modifier les données de domaine ou la synchronisation.
