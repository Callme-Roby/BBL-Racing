# BBL KART 🏁

Jeu de course de karts 3D façon **Mario Kart 8**, en style **PS1** (low-poly, textures pixelisées,
polygones qui tremblent, tramage 15 bits)… avec **les têtes de tes potes** : les mêmes persos que
[BBL FIGHTERZ](https://github.com/Callme-Roby/BBL-Fighterz), leurs photos plaquées sur le visage, assis
dans des karts aux couleurs de leurs fringues.

> Mécaniques inspirées de Mario Kart 8 uniquement : aucun nom, visuel ni musique de Nintendo.

## Lancer en local

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # build de prod dans dist/
npm run sim        # course simulée sans écran (test de la physique et de l'IA)
```

## Mettre en ligne (Vercel)

Importe le dépôt sur [vercel.com](https://vercel.com) (Add New… → Project) : Vite est détecté tout
seul (`npm run build`, dossier `dist`, déjà configuré dans `vercel.json`). Chaque `git push` redéploie.

## Structure

```
src/
  race/       simulation de course : piste (spline), physique du kart, IA, course, objets
  render/     shader PS1, persos skinnés (squelette 19 os), karts, circuits, effets
  game/       monde 3D de la course (caméras, rendu écran partagé), réglages
  screens/    titre, sélection des pilotes, circuits, course, labo, options, manettes
  audio/      moteur WebAudio : musiques, bruitages, moteur du kart, voix
  input/      clavier, manettes, sticks arcade (configurables), tactile
  net/        PeerJS (en ligne)
  ui/         HUD, menus, commandes tactiles
dev/          banc de test de la simulation (npm run sim)
```

Fait avec [three.js](https://threejs.org), [Vite](https://vite.dev), TypeScript et [PeerJS](https://peerjs.com).
