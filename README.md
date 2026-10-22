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
npm run sim -- hood 120 normal   # course simulée sans écran (physique et IA)
npm run map -- dojo              # plan d'un circuit (debug)
npm run check                    # karts sous la route / caméra sous le sol : test sur tous les circuits
```

## Modes

- **GRAND PRIX** : une coupe de 4 courses, points (15, 12, 10, 9…), classement et podium.
- **COURSE SIMPLE** et **CONTRE-LA-MONTRE** (records et fantôme du meilleur temps gardés dans le navigateur).
- **MULTIJOUEUR** : écran partagé 2 à 4 joueurs (clavier + manettes), course simple ou grand prix.
- **EN LIGNE** : l'hôte crée une partie et envoie le lien ; jusqu'à 8 joueurs (les places libres
  vont aux CPU), l'hôte choisit le circuit, les points s'additionnent course après course.
  Pas de rollback : chaque navigateur simule son propre kart et envoie son état 20 fois par seconde,
  les autres karts sont affichés lissés (interpolation ~110 ms) ; l'hôte fait rouler les CPU et
  arbitre les objets, les positions et le classement final.

## Commandes

| | Clavier (solo) | Manette |
|---|---|---|
| Diriger | ← → / A D | stick gauche / croix |
| Accélérer | ↑ / W | A |
| Freiner / reculer | ↓ / S | B ou Y |
| Déraper (sauter) | Espace / Maj / L | RB ou RT |
| Objet (↑ devant, ↓ derrière) | E / K / Ctrl | LB ou LT |
| Regarder derrière | R / J | X |
| Pause | Échap / Entrée | Start |

À deux sur un clavier : J1 = ZQSD/WASD + Maj gauche + E, J2 = flèches + Maj droite + K. Les touches sont configurables dans **OPTIONS → MANETTES**. Sur téléphone (portrait ou paysage) :
volant tactile à gauche, GAZ / FREIN / DRIFT / OBJET à droite (accélération auto en option).

Techniques : dérapage avec mini-turbo bleu → orange → violet, turbo de départ (accélère pendant
le « 2 »), figure sur les tremplins (DRIFT en l'air), aspiration derrière un kart, zones
anti-gravité (cogner un kart = turbo), sortie de piste = un pote te repêche.

## Circuits et objets

SUNSET BOULEVARD (quartier), SKY DOJO (dojo dans les nuages), NEON PARKING (parking de nuit),
TROPICAL BEACH (plage), et leurs versions inversées ; deux coupes : COUPE BBL et COUPE RETOUR.
Objets : turbo (×1, ×3), sauce, toile d'Enola, ballon de Matteo (×1, ×3), mots de Billel,
grenade de Clément, micro, mode sayan, bazooka, config — distribués selon ta position.

## Serveur PeerJS (en ligne)

Par défaut le broker public PeerJS sert à se trouver. Pour le tien (`npx peerjs --port 9000`) :
variables `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_SECURE` au build ;
relais TURN dédié : `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`.

## Mettre en ligne (Vercel)

Importe le dépôt sur [vercel.com](https://vercel.com) (Add New… → Project) : Vite est détecté tout
seul (`npm run build`, dossier `dist`, déjà configuré dans `vercel.json`). Chaque `git push` redéploie.

## Structure

```
src/
  race/       simulation de course : piste (spline), physique du kart, IA, course, objets
  render/     shader PS1, persos skinnés (squelette 19 os), karts, circuits, effets
  game/       monde 3D de la course (caméras, écran partagé), grand prix, records, salle en ligne
  screens/    titre, sélection des pilotes, circuits, course, labo, options, manettes
  audio/      moteur WebAudio : musiques, bruitages, moteur du kart, voix
  input/      clavier, manettes, sticks arcade (configurables), tactile
  net/        PeerJS (en ligne)
  ui/         HUD, menus, commandes tactiles
dev/          banc de test de la simulation (npm run sim)
```

Fait avec [three.js](https://threejs.org), [Vite](https://vite.dev), TypeScript et [PeerJS](https://peerjs.com).
