# Vestigia cave simulations

An editable copy of the Lascaux and Chauvet viewers from Vestigia for experimenting with lamplight. Both caves use the same light and playback code, with separate scene settings.

## Run locally

Install Git and Node.js 22 or newer. Open a terminal in this repository and run:

```sh
npm ci
npm run setup
npm run build
npm start
```

Open [Lascaux](http://127.0.0.1:4173/lascaux/) or [Chauvet](http://127.0.0.1:4173/chauvet/) in a browser with WebGL 2. The setup command downloads about 96 MB of assets from Vestigia and verifies them against the checksums in [assets.json](assets.json). After setup, the viewers use the local copies. For automatic rebuilds, run `npm run dev` in a second terminal and refresh the browser after an edit.

## Work on the flame

Create a branch before editing:

```sh
git switch -c flame-physics
```

- [Lamp playback](src/lamp-playback.js) samples the recorded photodiode traces. Use this as the starting point for changing how light intensity varies over time.
- [Cave light controller](src/cave-light-controller.js) puts the light sources into the scene and updates their positions, brightness and shadows.
- [Wall lighting](src/lamp-lighting.js) combines the contribution of the lamps and limits the displayed modulation.
- [Lascaux flame](src/lascaux/flame.js) and [Chauvet flame](src/chauvet/flame.js) draw the visible flame. Changes to its appearance and changes to the light falling on the wall can be tested separately.

The current viewer uses recorded variations in brightness and an illustrative flame shape. The recordings give a reference to compare with a new flame model. The displayed brightness is uncalibrated.

## Asset credits

Lascaux survey models are credited to Perazio Engineering and the Ministère de la Culture / Centre national de préhistoire. The source collection is [Grotte de Lascaux LOD](https://archeologie.ecorpus.eu/ui/scenes/Grotte%20de%20Lascaux%20LOD), credited as CC BY-SA in Vestigia. The Chauvet model is the [Horses Fresco via Google Arts & Culture](https://artsandculture.google.com/asset/fresque-des-chevaux/rQE_FzwjhB5e9Q). The copied pages preserve the original credits and links. Setup retrieves the models, derived previews, poster and published optical playback files from the existing Vestigia endpoints. Those files stay outside Git. Third-party library notices are included under [public/lascaux-assets](public/lascaux-assets).
