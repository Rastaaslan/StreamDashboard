# SC3 Settings UI Parity — cohérence de navigation Windows / Android

**Date :** 05/11/2026 · **Périmètre :** source 3.0 uniquement, sur FIXE Windows 11 via Remote Desktop Commander.

## Contrat respecté

- **FIXE / PC stream** : une seule autorité OBS, scènes, minuteur, mixeur OBS, replays et planning partagé. Les paramètres de la régie doivent explicitement cibler FIXE, même lorsque l'interface est ouverte depuis un client.
- **Laptop Windows / PC jeu** : navigateur/pilotage distant, macros autorisées et préférences locales, sans seconde connexion OBS ni minuteur maître. Association à FIXE nécessaire pour piloter.
- **Android** : navigation stable **Accueil, Live, Sons, Planning, Plus**. Les réglages sont des écrans secondaires de *Plus*, pas un sixième onglet. Deck et macros disponibles depuis Sons/Plus ; compte Twitch Android direct seulement sur choix explicite, chat de FIXE par défaut lorsqu'appairé.
- **Comptes et services** : le compte local d'un appareil est distinct du compte/du jeton de FIXE ; une topologie Double-PC + Android Deck ne prouve aucune association effective.
- **Windows** : les paramètres restent dans le volet Administration, séparé du volet Régie. Aucun changement à la V3.1 modulaire.

## Écarts constatés puis corrigés

1. Avant ce lot, l'entrée « Configuration » du menu Plus et celle de Windows ouvraient directement l'onglet OBS, sans guide des pôles ni voie directe vers Android Deck.
2. Ajout d'une **page d'accueil Paramètres** avec groupes **Appareils, Régie, Comptes et services, Appareil** et rubriques **Appareils & Deck / OBS et scènes / Twitch / Connexions / Préférences**.
3. Android autonome ne voit pas de formulaire OBS maître ; son compte Twitch local apparaît sous Comptes et services. Sur une régie associée, les paramètres de profil d'hôte sont identifiés comme ceux de la régie, et navigation/stockage comme ceux de l'appareil local. Aucun token n'est transféré.
4. Depuis Plus, un raccourci « Appareils & Deck » ouvre directement cette rubrique, sans modifier de topologie ni créer d'appairage. Navigation explicite « Retour à Plus » et catégories accessibles au clavier. Les entrées de la sidebar Windows gardent leurs groupes Régie/Administration.
5. Les formulaires existants sont conservés : IDs `settings-form`, `platform-form`, `profile-settings`, `data-task` de connexion/permissions/transfert, valeurs de scènes et micro sauvegardées même si OBS est hors ligne. Aucun changement API/schéma/permissions/OBS/Twitch public.
6. L'onglet Android reste un système cinq destinations et les raccourcis profonds restent secondaires. Les types de catégorie et de rôle n'accordent jamais de capacité par déduction de l'écran.

## Fichiers du lot

- `apps/mobile/control/settings-navigation.js` : contrat de catégories et page d'accueil sans effet de bord.
- `apps/mobile/control/settings-view.js` : intégration des nouvelles catégories et distinction local/régie.
- `apps/mobile/control/control.js` : accès direct sûr vers Appareils & Deck et réouverture de Paramètres sur le sommaire.
- `apps/mobile/control/mobile-five-tab-ui.js` : raccourcis depuis Plus.
- `apps/mobile/control/index.html`, `control.css` : libellé Windows et comportement responsive.
- `tests/streamcockpit3-settings-navigation-browser.test.ts` et ajustement d'une assertion d'échappement HTML dans `tests/streamcockpit3-settings-topology-browser.test.ts`.

## Qualification sur la source actuelle FIXE

- Tests ciblés **36 PASS / 0 FAIL / 0 skipped**, six suites, dont navigation Android cinq onglets, source Twitch chat FIXE par défaut, préservation OBS, rendu/sémantique des paramètres et Edge véritable en **320 / 390 / 1366 px**, sans appel réseau ni commande OBS/Twitch. Log `%TEMP%\sc3-settings-navigation-final-20261105.log`.
- Les deux premières assertions ont d'abord échoué sur la représentation HTML correctement échappée `&amp;` ; attentes ajustées sans diminuer la sécurité et **campagne finale complète relancée PASS**.
- `tsc -p tsconfig.json --noEmit` PASS ; `tsc -p tsconfig.browser-js.json` PASS ; `node --check` des quatre modules JS PASS ; `security:check` PASS (**6757 fichiers**). Log `%TEMP%\sc3-settings-navigation-static-20261105.log`.
- La matrice F07 reste **partial**, G2 **in_progress**, G3/G4/G5 **open**. Aucune réception Android physique, aucun contrôle d'appairage réel nouveau, aucune installation/release/signature/rollback.
- Les cinq fichiers F05 / CONTINUITY déjà modifiés par un autre propriétaire n'ont été ni écrasés, ni indexés, ni committés. La documentation de ce lot est volontairement séparée.

## Suite

Quand les intégrations G2 seront prêtes, produire et contrôler une paire QA Windows x64 / Android **issue du même commit**, en conservant RC2. L'installation et le test réel d'Android (Plus → Paramètres → Appareils & Deck → association à FIXE) nécessitent un accord distinct et restent non réalisés dans ce lot.
