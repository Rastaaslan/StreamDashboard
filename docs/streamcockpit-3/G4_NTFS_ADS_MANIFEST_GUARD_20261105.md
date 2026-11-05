# G4 — rejet des flux alternatifs NTFS dans les manifestes (05/11/2026)

## Préflight et périmètre
- Accès exclusivement RDC FIXE ; quatre documents PLAN, feature-matrix, CONTINUITY et MIGRATION lus avant intervention. Branche canonique, origin GitHub attendu, HEAD initial `2092ee0`, sans index.lock, rebase ou propriétaire actif sur les fichiers G4. Le dépôt avait cinq fichiers F05 et CONTINUITY modifiés par un autre propriétaire ; ils sont restés hors portée, non indexés et non écrasés.
- OBS ouvert : aucune commande OBS/Twitch, installation, signature, publication, profil utilisateur ou autre projet/machine modifiés. Aucun build de distribution ni campagne concurrente lourde.
- Lot restreint au validateur de manifeste, à son test, à cette preuve et à l'entrée F10 de la matrice.

## Défaut reproduit, correction et tests
- Un chemin Windows `C:\\SC3\\StreamCockpit.exe:payload.exe` était accepté par `validateArtifactManifest` parce que le chemin semblait absolu et se terminait par `.exe` ; même cas Android `.apk:shadow.apk`. Sous NTFS, une deuxième occurrence de deux-points après la lettre du lecteur désigne potentiellement un flux de données alternatif, **pas le fichier ordinaire attendu** par le manifeste.
- Régression RED sur le code initial : **7 PASS / 1 FAIL / 0 skipped**, log `.git/sc3-g4-ads-red-20261105.log`. Le test a montré l'acceptation indue avant modification.
- Correctif étroit : refuser toute seconde occurrence de `:` après le préfixe du lecteur Windows dans les chemins EXE/APK du manifeste ; conserver l'acceptation des chemins absolus locaux valides. Aucun fournisseur ni matériel sollicité.
- GREEN : **11 PASS / 0 FAIL / 0 skipped**, dont 8 cas vérificateur et 3 roadmap, log `.git/sc3-g4-ads-green-20261105.log`.
- `npm run build:types` PASS, `npm run check:browser-types` PASS et `npm run security:check` PASS (**6750 fichiers**, dont des sources F05 non commitées), logs `.git/sc3-g4-ads-{build-types,check-browser-types,security-check}-20261105.log` ; `git diff --check` PASS, avertissements CRLF non bloquants.

## Limites et suite
- Le test prouve la validation de **chaînes de chemins**, pas une lecture réelle d'ADS NTFS ni une signature Windows/Android. Il n'atteste pas la provenance embarquée indépendante, un APK de production, une installation, une migration ou un rollback. G4/G5 restent OPEN, G2 in_progress et F10 partial.
- Les fichiers F05/CONTINUITY appartenant à un autre propriétaire n'ont pas été touchés. Cette note doit être reprise dans CONTINUITY seulement après libération du fichier ; aucune qualification artificielle.
- Suite à privilégier : réception matérielle autorisée G3, provenance indépendante des deux artefacts, signatures compatibles et migration/repli réels, sans dégrader Contra/Director.
