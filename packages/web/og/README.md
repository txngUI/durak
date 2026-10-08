# Image d'aperçu des liens

`og-image.svg` est la source de `public/og-image.png` (1200 × 630), affichée quand on partage le lien du jeu (Discord, WhatsApp, X…). Les balises `og:*` sont dans `index.html`.

Pour régénérer le PNG après une modification, avec les polices Yeseva One, Golos Text et JetBrains Mono installées :

```bash
rsvg-convert -w 1200 -h 630 packages/web/og/og-image.svg -o packages/web/public/og-image.png
```
