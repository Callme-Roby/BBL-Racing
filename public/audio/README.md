# Sons de BBL FIGHTERZ — ajouter tes propres fichiers

Par défaut, **tout le son du jeu est généré en direct** par le navigateur, sans aucun fichier :
musiques des stages (synthés rétro façon PS1), bruitages des coups et voix (synthèse vocale du navigateur).

Tu peux remplacer n'importe quel son par un vrai fichier audio. Si un fichier est introuvable ou
illisible, le jeu revient tout seul au son généré (avec un simple avertissement dans la console) :
tu ne peux rien casser.

## Où mettre les fichiers

Range-les dans ce dossier (`public/audio/`), par exemple :

```
public/audio/
  music/      hood.mp3, dojo.mp3, ...
  sfx/        hit_heavy.wav, bell.mp3, ...
  announcer/  round1.mp3, fight.mp3, ko.mp3, ...
  voices/     blaze_intro.mp3, blaze_win.mp3, ...
```

Formats conseillés : **.mp3** (marche partout), ou .ogg / .m4a / .wav.

## Musiques, bruitages et annonceur

Ouvre `src/audio/manifest.ts` et décommente (ou ajoute) une ligne par fichier.
Les chemins sont **relatifs, sans `/` au début** :

```ts
export const MUSIC_FILES = {
  hood: 'audio/music/hood.mp3',
};

export const SFX_FILES = {
  hitHeavy: 'audio/sfx/hit_heavy.wav',
  roundBell: 'audio/sfx/bell.mp3',
};

export const ANNOUNCER_FILES = {
  fight: 'audio/announcer/fight.mp3',
  ko: 'audio/announcer/ko.mp3',
};
```

Les noms disponibles :

- **Musiques** : `title` (écran titre), `select` (choix du perso), `hood` (stage Sunset Hood),
  `dojo` (stage Sky Dojo), `parking` (stage Neon Parking), `victory` (jingle de victoire, joué une fois).
- **Bruitages** : `hitLight`, `hitMedium`, `hitHeavy`, `block`, `whiff`, `whiffHeavy`, `land`, `step`,
  `fall`, `throw`, `super`, `ko`, `cursor`, `confirm`, `cancel`, `roundBell`.
- **Annonceur** : `round1`, `round2`, `round3`, `finalRound`, `fight`, `ko`, `doubleKo`, `perfect`,
  `timeUp`, `youWin`, `youLose`, `draw`, `chooseFighter`, `gameTitle`.

Conseils :

- Musiques qui bouclent : exporte une boucle propre (pas de silence au début ni à la fin).
- Bruitages : coupe le silence au début du fichier, sinon le coup sonnera en retard.
- Les volumes (général / musique / bruitages / voix) sont mémorisés dans le navigateur.

## Voix des personnages

Les répliques des persos (intro, victoire) sont lues par la synthèse vocale du navigateur, en
français par défaut. Pour utiliser de vrais enregistrements (ta voix, celle de tes potes...),
indique les fichiers dans la fiche du personnage : voir `src/data/roster.ts`
(champ `voice`, par exemple `introFile: 'audio/voices/blaze_intro.mp3'` et `winFile`).

Tu peux aussi y régler la voix de synthèse : `lang` (ex. `'fr-FR'`), `pitch` (grave 0 → aigu 2)
et `rate` (vitesse, 1 = normal).

## Tester

Lance `npm run dev`, ouvre le jeu et clique une fois dans la page (les navigateurs bloquent le son
tant qu'on n'a pas cliqué ou appuyé sur une touche). Si un fichier ne se charge pas, la console du
navigateur (F12) affiche `[audio] could not load ...` avec le chemin en cause.
