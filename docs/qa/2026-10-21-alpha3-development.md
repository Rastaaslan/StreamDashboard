# StreamDashboard Next 2.1.0-alpha.3 — développement après audit

Version candidate issue de l’alpha.2, base canonique `6958e5bedc60932342566efd787df3c44b5092b8`. Branche serveur `work/next21-audit-alpha3`, dossier `/home/damien/StreamDashboard-Next-alpha3`. Aucune version installée modifiée ; aucun direct ni message réel déclenché pendant ce travail.

## Changements

| Audit | Résultat |
| --- | --- |
| A01–A02 · arrêt | L’arrêt atteint les deux sorties OBS même si YouTube a épuisé son quota. Il interrompt l’attente d’un démarrage, passe devant les actions en attente, et reste accessible dans l’interface. Les autorisations et l’association du bouton sont vérifiées avant cette interruption. Une confirmation cloud manquante reste signalée comme incertaine. |
| A03–A04 · Android et hors ligne | Identifiants compatibles avec l’origine HTTP Android ; ajout des modules YouTube et cloud à la liste des ressources hors ligne réellement préchargées. |
| A05 · autonomie cloud | Depuis Android : création d’une diffusion YouTube, association d’un flux réutilisable, sélection de la cible et application des informations Twitch/YouTube. Vérification du compte et de la propriété des cibles. Journal enregistré avant les mutations ; aucune répétition automatique d’une création incertaine. |
| A06 · chat Twitch | Lecture native via IRC TLS et envoi Helix avec le compte OAuth de l’application. Historique borné, isolation par compte, messages affichés comme texte. La reconnexion Twitch est nécessaire pour accorder les nouveaux droits. |
| A07 · quota | Observation YouTube espacée de cinq minutes après une erreur de quota. Ce délai ne bloque pas une demande explicite d’arrêt local. |
| A08 · continuité | Conservation de la WebView à la rotation, enregistrement du brouillon de métadonnées pendant la saisie, option de maintien de l’écran éveillé. L’exécution durable en arrière-plan n’est pas ajoutée : l’application doit rester ouverte pour ses services locaux. |
| A09 · téléphone | Page Live autonome simplifiée, réglages OBS masqués sur Android autonome, connexion via les comptes locaux et favoris initiaux adaptés aux actions locales. |
| A10 · automatisations | L’interface explique qu’une régie associée exécute les règles. L’édition est bloquée en Android autonome, qui ne possède pas de moteur d’automatisation. |
| A11 · versions | Android et la CI dérivent version et code depuis `package.json`. La matrice de qualification référence alpha.3 ; les preuves matérielles manquantes restent ouvertes. |

## Validation

- Vitest : 1 477 tests distincts validés. Les quatre fichiers dépendant de l’accès réseau local ont été exécutés sur dam-server ; une régression supplémentaire vérifie le refus d’un ancien bouton d’arrêt réassigné.
- Node : 354 tests distincts validés. La passe complète a trouvé une omission de préchargement, corrigée puis vérifiée par la relance des trois tests hors ligne concernés.
- Interface navigateur : 113 réussites, aucune erreur, aucun test ignoré. Les nouveaux parcours Android utilisent des ponts natifs simulés ; aucun compte réel n’a été modifié.
- Android : 47 tests JVM, harnais Java des politiques natives réussi, lint sans erreur et 15 avertissements déjà présents. APK construite avec succès.
- Syntaxe des 89 fichiers JavaScript livrés et contrôle de sécurité réussis. Les 113 ressources d’interface embarquées dans l’APK correspondent aux sources.
- Windows : paquet x64 construit, version, ressources, exclusions et intégrité EXE/ASAR vérifiées.

Ces vérifications ne remplacent pas les essais sur téléphone physique : autorisations OAuth, réception réelle du chat, rotation, écran éteint et reprise réseau. Les nouvelles permissions Twitch et YouTube demandent une reconnexion du compte si l’ancien consentement est insuffisant. La validation universelle conserve 75 lignes ouvertes ; cette candidate ne doit pas être présentée comme une version finale universellement qualifiée.

## Orchestration et coût

Sentinel est actif mais aucune campagne n’a été admise : l’admission administrateur protégée n’est pas disponible dans cette session. Une unique tentative CodexBridge a été refusée avant démarrage, sa copie protégée du dépôt ne contenant pas la base alpha.2. Aucun job CodexBridge n’a tourné et aucune boucle de relance n’a été engagée. Le développement a donc été effectué dans cette session, avec scripts et tests déterministes, puis persisté dans une branche isolée.

## Artifacts

- APK : `StreamDashboard-Next-2.1.0-alpha.3.apk`, code `2010003`, 3 766 946 octets ; même certificat que l’alpha.2.
- SHA-256 APK : `f87905f106ef66a7a3d1418f65c2de2a2ff963811ed07c1e2dfcf7fbfdd81932`.
- Windows, rôles régie et contrôleur : `out/StreamDashboard-win32-x64` dans le dossier candidat du serveur. Un même binaire fournit les deux rôles.
- SHA-256 EXE : `bf8b14b0738f3d29624fdc3ef8c4026c26a4046df801253c709689544e4ad865`.
- SHA-256 ASAR : `50fa42811a06bcf0f2ed2c08664db468e35f51ead3b076a3cc42f3baefb0cbde`.

Les paquets sont des candidats de test. Aucun déploiement sur les deux PC et aucun remplacement de l’application du téléphone n’ont été effectués par cette session.
