# F09 Streamlabs et campagne intégrée précédente

Les fichiers integrated3-* et prior-packaged-build.json concernent a13df025868d7e57374c7f59d043bbd8db233e8e : 2286 PASS / 108 skipped / 0 FAIL Vitest, 351 PASS / 6 skipped Node, réseau 35/35 et trois tests Electron sur le paquet x64. Ils précèdent le correctif audio concurrent c5ea85f et le producteur Streamlabs ajouté ici.

Le complément Streamlabs est couvert par targeted2 (76 PASS / 6 skipped), moments-all (129 PASS / 11 skipped, seize fichiers) puis moments-edge (cinq cas Edge 320 px activés, tous PASS). Types, build, JS livré et sécurité sont séparés. integration.txt ne sélectionnait que cinq fichiers (35 PASS) à cause d’un filtre glob littéral ; la campagne moments-all utilise la liste complète explicite.

moments-native-restart.txt est un test réel du paquet a13df025 : SQLite, ajout repère sous observation OBS fictive, fermeture puis Agent sans fenêtre, journal et statut retrouvés. Aucun test physique ou compte de production. Deux erreurs de harnais restent visibles : attente erronée d’un journal vide au lieu d’unknown/503 ; statut GET de réconciliation confirmé au lieu du statut observé porté par le repère. Le premier échec TypeScript d’inférence circulaire est conservé ; une annotation explicite corrige l’inférence.

original-logs.zip conserve les 21 journaux octet pour octet. original-sha256.json donne taille et SHA-256 ; les copies .txt normalisent uniquement UTF-16/UTF-8, ANSI et espaces terminaux. Ni ces preuves ni les skipped ne qualifient G2–G5. La nouvelle campagne générale et le paquet qui suivront devront préciser leur propre commit source.
