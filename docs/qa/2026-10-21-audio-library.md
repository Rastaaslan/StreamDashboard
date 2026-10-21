# Copie des bibliothèques audio entre appareils

La page **Appareils et comptes → Copier une bibliothèque audio** permet de choisir une source et une destination parmi les agents Windows, les Android associés et l’espace autonome de l’appareil courant. Les fichiers restent sur la source. Aucun son n’est déclenché par cette opération.

Le catalogue est prévisualisé avant confirmation. Les identités, noms, catégories, favoris, activation, volumes, délais et modes de lecture/écoute sont conservés. Les nouveaux sons utilisent la sortie système de la destination. Une sortie OBS ou un périphérique propre à un appareil ne sont pas transportés implicitement. Les sorties des sons déjà présents restent inchangées.

Chaque fichier est lu par blocs de 64 Kio et vérifié par SHA-256 avant envoi. L’export ne reçoit aucun chemin arbitraire et n’expose ni chemin local ni secret. Ses instantanés sont réservés au contrôleur autorisé, limités à huit lectures et 200 Mio en mémoire, avec expiration après cinq minutes d’inactivité. Chaque fichier reste limité à 100 Mio ; une bibliothèque à 1 000 entrées. Les autorisations et l’identité de l’espace sont revérifiées pendant les échanges.

La destination Windows publie le fichier avec son catalogue et le reçu durable de copie après écriture réussie. Le journal est borné à 4 096 reçus et refuse de nouveaux transferts à saturation. Les espaces autonomes Windows/Android réutilisent la transaction IndexedDB du protocole audio. Un fichier de même identité et de contenu ou réglages différents provoque un conflit ; il n’est pas remplacé. Une entrée supprimée après une première copie n’est pas restaurée automatiquement par un reçu ancien.

Le journal de copie est sauvegardé sur le contrôleur avant chaque import et après chaque confirmation. Une nouvelle tentative conserve les identités et les fichiers déjà confirmés. Le téléchargement source du fichier interrompu recommence ; l’envoi Android reprend les blocs déjà reçus. Si la fenêtre du contrôleur ferme, la reprise reste explicite depuis cette page. « Arrêter cette copie » conserve les originaux et les fichiers déjà copiés.

Un retour vers la source utilise le même parcours en inversant les espaces. Les agents doivent annoncer la version du protocole de bibliothèque : une ancienne version est refusée avant l’envoi pour éviter l’abandon silencieux des réglages ou du contrôle d’identité.

## Portée et limites

Cette évolution réalise une copie additive et reprenable de la bibliothèque, avec publication atomique par fichier. Elle ne déplace pas en une transaction globale les macros, les configurations, les associations ou les responsabilités combinées. Les sons locaux importés avant l’enregistrement des empreintes peuvent demander une réconciliation explicite en cas de retour sur une identité préexistante. Aucune suppression automatique n’est prévue.

Les validations automatiques et les paquets de ce chantier sont consignés dans le rapport du candidat. Les essais matériels Android/Windows et les transitions complètes restent ouverts. La RC11.7 et les processus OBS ne sont pas modifiés.
