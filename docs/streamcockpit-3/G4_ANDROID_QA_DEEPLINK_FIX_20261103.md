# G4 préparatoire — isolation des deep links Android QA (FIXE, 03/11/2026)

## Préflight et défaut
- Départ : branche `streamcockpit/3.0-full-experience`, HEAD `78323b3`, origin `https://github.com/Rastaaslan/StreamDashboard.git`, arbre propre, aucun index/merge lock, pas de propriétaire auteur actif. `SC3-FINAL-DELIVERY-001` est déjà `lotComplete:true` pour son ancien HEAD ; F09-Q isolé. Seule machine consultée : FIXE par Remote Desktop Commander.
- Le nouveau variant Android `qa` du commit de départ déclare `streamdashboard-next-qa://` dans son manifeste, mais `DeepLinkRouter` exigeait inconditionnellement `streamdashboard-next://`. Résultat : `MainActivity` rejetait les intents `pair` et `oauth` propres à QA. Aucun appareil physique n'a servi à constater ce bug ; incohérence prouvée dans les sources compilées.

## Correction du code (4 fichiers)
- Commit source qualifié : `7aa857a15e69f6d4dc6faf3345df764650789840` (diff produits/tests uniquement ; pas de package signé associé à ce nouveau HEAD).
- Définition par variante de `DEEP_LINK_SCHEME` et du placeholder Android Manifest à partir de la même valeur Gradle : standard `streamdashboard-next`, preview `streamdashboard-preview`, QA `streamdashboard-next-qa`.
- `MainActivity` transmet `BuildConfig.DEEP_LINK_SCHEME` au parseur en capture **et** livraison des intents. `DeepLinkRouter` n'accepte que le schéma fourni, sans élargir la liste d'hôtes ni accepter port/fragment/userinfo.
- Les tests JUnit couvrent pair/OAuth QA, refus croisé standard/QA/preview et correspondance BuildConfig–variant, y compris le refus des schémas étrangers. Le mode QA conserve `PREVIEW_MODE=false`; la prévisualisation reste isolée.

## Preuves logicielles locales
- `testQaUnitTest` : **52 PASS, 0 FAIL, 0 skipped**, 11 fichiers XML de suite.
- `testDebugUnitTest` : **52 PASS, 0 FAIL, 0 skipped**, 11 fichiers XML de suite ; campagne croisée verte après ajout du garde BuildConfig. Journal `%TEMP%\sc3-78323b3-qa-deeplink-junit-final.log`.
- `assembleQa lintQa` : **PASS** sur les sources Java finales avant l'ajout du dernier test seul ; lint QA **0 error, 15 warnings**, JUnit QA précédent 51 PASS ; journal `%TEMP%\sc3-78323b3-qa-deeplink-gradle-final.log`.
- Inspection réelle de l'APK local `android/app/build/outputs/apk/qa/app-qa.apk` : `applicationId=com.rastaaslan.streamdashboard.remote.next.qa`, label « Le StreamCockpit 3 QA », **deux intent filters** `streamdashboard-next-qa`, `fileprovider` distinct. APK SHA-256 `6B4AF52255F9C1F862FD4399D33971A3DEF1AC30DD1EE65FA71E3490EC263529`. `apksigner verify` PASS **v2 DEBUG uniquement**, empreinte certificate SHA-256 `064a2ce0dd1e57d6fa21ad3491fb0a4df28a5b4717c74e622d1abe4d77aef81a`.
- TypeScript et types navigateur **PASS** ; sécurité **PASS, 6706 fichiers** ; test de cohérence roadmap **3 PASS / 0 FAIL / 0 skipped** ; `git diff --check` **PASS** (avertissement Git LF/CRLF non bloquant). Journal `%TEMP%\sc3-78323b3-qa-deeplink-final-static.log`. Aucune preuve logicielle n'est une preuve Android matériel ni une signature production.

## Limites / suite
- Le serveur génère encore les liens QR par défaut en `streamdashboard-next://pair` (normal pour l'application standard). **Un lien/canal QA distinct doit être produit avant de qualifier l'appairage par scan de QR en QA** ; l'écran Android possède aussi le formulaire d'association manuelle par HTTPS+code. Aucun test réseau Android réel, OAuth réel ou reprise après interruption.
- Le paquet QA est compilé à partir de sources de travail non commitées et **n'est ni candidat G4 ni distribution autorisée**. Aucune installation, migration utilisateur, publication, OBS/Twitch public ou secret modifié. F00–F10 partial ; G2 in_progress ; G3–G5 open.
