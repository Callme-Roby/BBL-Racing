# Visages des combattants

Mets ici les photos de visage des potes, puis référence-les dans `src/data/roster.ts`
(champ `face: 'faces/mon-pote.jpg'`).

Pour un bon rendu :

- photo **de face**, bien éclairée, sans ombre forte ;
- recadrage serré **du haut du front jusqu'au menton**, joues comprises ;
- format **portrait 3:4** (par exemple 240 × 320 px) — le jeu la réduit de toute façon en 72 × 96 px façon PS1 ;
- JPG d'environ 10 à 30 Ko.

Le shader plaque la photo sur l'avant de la tête avec un masque ovale qui se fond
dans la couleur de peau (calculée automatiquement à partir des joues).

> ⚠️ Si le dépôt GitHub est public, ces photos le sont aussi. Passe le dépôt en privé
> si tes potes préfèrent, ou crée les persos directement dans le jeu (menu **LABO**) :
> ils restent alors uniquement dans ton navigateur.
