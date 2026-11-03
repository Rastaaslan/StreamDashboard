# SC3 Desktop — correction intégration/ergonomie, 03/11/2026

## Autorité et portée
- Travail dans le dépôt canonique FIXE, branche `streamcockpit/3.0-full-experience`, HEAD initial `ff6fd38`, aucune concurrence d'édition, branche/remote contrôlés. RC2, F09-Q, OBS de production, secrets, états de live, profils installés et laptop laissés intacts pendant les correctifs.
- Basé sur `AUDIT_INTEGRATION_UI_RUNTIME_20261103.md`. Ce lot clôt des **écarts UI et de provenance** mais ne prétend pas fermer toutes les fonctions F00–F10 ni G3–G5.

## Corrections de code
1. **Live Desktop** : grille 2 colonnes au lieu de trois sous 1280+ px, chat Twitch à largeur exploitable, éléments longs repliables ou défilables dans le panneau, sans chevauchement. Le bloc vidéo et le suivi d'activité restent à gauche ; chat, modération, clips et interactions dans la colonne de droite avec scroll interne, sans modifier les commandes OBS/Twitch.
2. **Planning Desktop** : les propositions locales sont maintenant dans un élément `details` replié par défaut, avec liste plus compacte et boutons conservés sans publication automatique ; l'agenda réel retrouve sa priorité visuelle.
3. **Provenance Google** : le compte Google connecté sur la régie est identifié explicitement, **sans** changer la règle d'indisponibilité `UNKNOWN` pour les créneaux lointains ; aucun événement distant n'est inventé ni marqué comme importé. Vue client Google local facultatif et rappel que le planning maître vient de FIXE après appairage.
4. **Rôles Desktop** : le PC client non appairé ne montre plus des formulaires locaux de paramétrage OBS/sorties Twitch comme s'il détenait la régie ; il guide vers l'appairage FIXE. Les options restent disponibles sur la régie sélectionnée et l'on conserve un seul propriétaire des commandes OBS/minuteur.

## Qualification
- Vitest ciblé avant ajout du dernier rôle : 47 tests PASS (4 fichiers : planning, brouillons, intégration hôte, réglages Desktop), 0 FAIL ; dernier test rôle local OBS/Twitch : 7/7 PASS sur les 2 fichiers ciblés. Aucun test supprimé.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `npm run security:check` PASS sur 6712 fichiers ; `git diff --check` PASS (avertissements LF/CRLF non bloquants).
- Playwright Microsoft Edge réel, navigation de l'UI partagée avec CSS de source intercepté, contrôles à 1280, 1366, 1440, 1920 px : 0 erreur de page, 0 contrôle débordant du panneau Twitch et pas de largeur du document dépassant le viewport. Panneau chat : ~422 à 700 px selon l'écran, scroll interne contrôlé ; captures temporaires dans `out/sc3-audit-ui/`.
- Planning Edge 390, 1366, 1920 px avec CSS + modules de source interceptés : 0 erreur JS, compte Google de la régie identifié, statut de disponibilité toujours UNKNOWN, `<details>` fermé initialement et 3 suggestions toujours présentes après ouverture ; pas de débordement horizontal. Captures temporaires non distribuées.
- Build `npm run build` et `check:shipped-js` PASS (142 assets publics, 148 JS), fichier cache mobile généré actualisé depuis les ressources du lot.

## Limites / reste à qualifier
- Le nouveau build du code source n'est **pas** une preuve de démarrage du binaire Windows ni de réception réelle FIXE/laptop. Rebuild/packaging et tests d'installation restent nécessaires après commit pour embarquer la provenance exacte.
- Google Calendar compte connecté sur FIXE, mais planning local était vide et dernière synchronisation absente lors de l'audit ; aucune affirmation sur la présence d'événements réels dans le calendrier.
- Les commandes réseau depuis laptop/Android, audio VOD, capture micro DJI, Discord, Streamlabs, signatures Windows/Android production, migration et rollback doivent encore être testés en réception matérielle. G2 in_progress, G3–G5 open.
