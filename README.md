# RFLab

Build ham radio stations, see their antenna patterns in 3D, and predict coverage between them on 40 m, 20 m, 2 m and 70 cm. Runs in the browser with no install and no build step.

## Run it

Open `index.html` in Chrome or Edge, or serve the folder:

```bash
python -m http.server 8765
```

Everything it needs (Three.js, coastlines and US state borders included) ships in this folder, so it also works offline. The only outside request is Google Fonts, and the page falls back to system fonts without it.

## What it models

- **Antennas** (`js/nec.js`, `js/antennas.js`): a thin-wire method-of-moments solver (NEC-style EFIE, Galerkin, triangle basis) over real ground. Currents are solved with perfect-ground images; the far field uses Fresnel reflection for the chosen soil (the MININEC approach). Includes copper skin-effect loss. Antennas are auto-trimmed like you would trim them in the yard: dipoles, loops and verticals to resonance, the EFHW for lowest SWR through its 49:1, fan-dipole legs in place.
  HF types: half-wave dipole / inverted-V, fan dipole (40+20), full-wave doublet, EFHW, horizontal loop, delta loop, ground-mounted quarter-wave vertical (radial count sets ground loss), elevated ground plane, 2–5 element Yagi.
  VHF/UHF types: J-pole, stacked collinear (X50/X200 style, several in-phase feeds), elevated ground plane, mobile whip on a car roof, handheld rubber duck, dipole, Yagi (horizontal or vertical). VHF/UHF antennas are solved in free space, since the line-of-sight model brings in the ground.
- **Stations** have one radio and two antenna systems (HF and VHF/UHF), each with its own feedline, matching and power.
- **Feedline and matching** (`js/data.js`, `js/prop.js`): datasheet-fit coax loss for RG, LMR and Heliax lines plus 450 Ω window line, extra loss from SWR, balun/unun loss, built-in or external tuner.
- **VHF/UHF line of sight** (`js/prop.js`): smooth earth with a 4/3 effective radius. Two-ray (plane-earth) loss inside the radio horizon, ITU-R P.526 spherical-earth diffraction beyond it, a rough troposcatter floor for long paths, a terrain-roughness setting, local clutter from each station's surroundings (trees, buildings) against antenna height, each station's ground elevation, and polarization mismatch from the solved patterns.
- **HF propagation** (`js/prop.js`): simplified sky-wave model with F2 hops, a MUF that follows the sun at each reflection point and the solar activity setting, D-layer absorption, ITU-R P.372 man-made noise at each end, and reliability from day-to-day MUF and fading spread.

## Tests

```bash
node tests/nec.test.js     # solver against textbook values (λ/2 dipole 2.15 dBi, λ/4 monopole 5.15 dBi, ...)
node tests/ant.test.js     # every antenna type on 40 m and 20 m
node tests/prop.test.js    # example HF stations through the full chain
node tests/vhf.test.js     # VHF/UHF antenna types on 2 m and 70 cm
node tests/los.test.js     # line-of-sight path loss and example VHF stations
```

## Next up

80 m, 33 cm (Meshtastic), real terrain profiles from elevation data, repeaters, ground wave for short paths, VOACAP-grade propagation, shareable setup links.
