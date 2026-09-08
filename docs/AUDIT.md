# Audit de migration V1

Les comportements utiles des prototypes historiques ont été réimplémentés nativement : séquences et timer dans l'orchestrateur local, calendrier dans le stockage local, commandes de diffusion dans l'adaptateur OBS. `_integration_sources` est conservé intact comme référence uniquement.

La nouvelle exécution ne lance, n'importe et ne contacte ni StreamTool ni damPlanner. Cette séparation permet aux deux outils de rester indépendants tout en donnant à StreamDashboard son propre cycle de vie.
