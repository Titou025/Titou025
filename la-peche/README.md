# 🍑 La Pêche

Suivi calories + macros pensé TDAH et hyperphagie. Web app installable sur iPhone. Données 100 % sur le téléphone.

## Fonctions
- Ajout en 2 taps : récents, « comme hier », ajout rapide kcal
- Aliments de base sans marque (œuf, riz, fruits...) via la table Ciqual de l'Anses, avec comptage en pièces
- Scanner de code-barres (caméra ou photo) + recherche par marque via Open Food Facts
- Plats maison : recette enregistrée une fois, puis 1 tap par portion
- Barre de progression sans rouge, message bienveillant si dépassement
- Lissage hebdo de l'écart (max -10 %/jour, plancher, protéines fixes, jours de crise exclus)
- Bouton « J'ai fait une crise » : déclencheurs, note, zéro jugement
- Objectifs 1700 kcal / P140 / L40 / G195, lipides et glucides affichés comme budget flexible
- Journal des émotions, fiertés et gratitudes, récap du dimanche et résumé mensuel à partager avec son psy
- Yoga 3x/semaine avec récompense et badges, objectif 10k pas
- Suivi sport : récompense si 2 salle + 1 danse ou 3 salle dans la semaine
- Photo hebdo + comparateur avant/après mensuel
- Pesée mensuelle, tendance douce (chiffres masqués par défaut)
- Rappels via calendrier iPhone (.ics), sauvegarde/restauration JSON

## Installer
1. GitHub : Settings → Pages → Source « Deploy from a branch » → `main` / root
2. Sur l'iPhone, ouvrir `https://titou025.github.io/Titou025/la-peche/` dans Safari
3. Partager → « Sur l'écran d'accueil »
4. Réglages de l'app → objectifs → « Ajouter les rappels au calendrier »

Scanner : [html5-qrcode](https://github.com/mebjas/html5-qrcode) 2.3.8 (Apache 2.0), embarqué dans `lib/`.
