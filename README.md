<p align="center"><img src="docs/logo.png" width="96" alt="AECopy logo"></p>

<h1 align="center">AECopy</h1>

<p align="center"><b>Ctrl+C in one After Effects, Ctrl+V in another. Or just drag and drop.</b><br>
Layers, effects, keyframes and whole compositions, between two windows or two versions (2020 to 2026).<br>
Windows · v1.1.0 · by <a href="https://ilhanturan.fr">Ilhan Turan</a></p>

<p align="center"><img src="docs/window.png" width="440" alt="AECopy window"></p>

> Made with the help of AI. Tested a lot, but not 100% reliable: keep a backup of important projects and please report anything that does not paste right ([Issues](../../issues)).

## Install

1. Download the [latest version](../../releases/latest) and unzip it **in a folder where it will stay** (e.g. `C:\Tools\AECopy`, not Downloads). Keep `AECopy.exe`, `AECopy.jsx` and the `cep` folder together: AECopy writes its logs next to the exe and its After Effects extension points to that folder.
2. In **every** After Effects you use: *Edit > Preferences > Scripting & Expressions >* tick **Allow Scripts to Write Files and Access Network**.
3. Allow unsigned After Effects extensions (once per Windows user). In PowerShell:
   ```powershell
   foreach ($v in 9..12) { $k = "HKCU:\Software\Adobe\CSXS.$v"; if (-not (Test-Path $k)) { New-Item $k | Out-Null }; New-ItemProperty $k -Name PlayerDebugMode -Value 1 -PropertyType String -Force | Out-Null }
   ```
4. Run `AECopy.exe`. It installs its invisible extension for After Effects and starts with Windows (can be turned off).
5. **Restart After Effects**: the extension loads when After Effects starts. Each one then shows *Connected* in the AECopy window.

## Use

- Select layers, effects/keyframes, or a composition in the Project panel, press **Ctrl+C**.
- Click in the other After Effects, press **Ctrl+V**.
- Same After Effects: normal Ctrl+C / Ctrl+V, AECopy stays out of the way. With only one After Effects open, AECopy does nothing on Ctrl+C.
- **Drag & drop:** drag your selection from one After Effects and drop it on the other one, across screens too. A label near the cursor shows where it will land.
- **Images:** copy an image anywhere (right-click > *Copy image* in a browser, a screenshot...), press **Ctrl+V** in After Effects. It is saved as a PNG, imported and placed in the open comp.

| You copied or dragged | It pastes |
|---|---|
| Layers | in the open comp, above the selected layer (a comp is created if none is open) |
| Effects, properties, keyframes | on the selected layers, keys starting at the current time |
| A composition (Ctrl+V) | in the project, with its precomps, footage and solids |
| A composition (drag & drop) | in the project **and** as a layer in the open comp |
| An image copied outside After Effects | saved as PNG in an `AECopy Pasted` folder next to the saved project (or `Pasted images` next to AECopy), imported in an *AECopy Pasted* Project folder, placed in the open comp at the current time |

## Options

| Switch | What it does |
|---|---|
| Start with Windows | AECopy waits in the tray and wakes up when an After Effects opens. |
| Drag & drop | Drag a selection from one After Effects to the other. |
| Paste images | Ctrl+V of an image copied elsewhere (off: After Effects' normal paste). |
| Fit to comp size | Pasting into a comp of another size (e.g. 1920x1080 into 1080x1920): comp-sized solids and adjustment layers take the new size; positions, anchor points, effect points (Motion Tile, Lens Flare...) and masks follow in proportion. Values in pixels (a blur radius...) stay as they are. |

## What works

- Solids, adjustment layers, nulls, text (point, paragraph, vertical, on a path), shapes (all operators), precomps, footage, image sequences, audio, placeholders, cameras, lights, 3D model layers.
- Effects (all parameters, layer references renumbered), masks, keyframes (ease, hold, spatial, roving, labels), expressions, markers, parenting, track mattes, time remap, time stretch, blending modes, switches.
- Composition settings (size, frame rate, duration, background, work area, motion blur, 3D renderer…).
- Text styles: font, size, colors, stroke, tracking, leading… and **several styles in one text** when pasting into After Effects 2024.3 or later (also when copied from 2020).
- Missing footage becomes a placeholder; footage already in the target project is reused.
- After each paste, AECopy compares the result with the original and reports any difference.

## What does not work

- Internal effect data scripts cannot read: Curves, Hue/Saturation channel range, shape gradient colors, Mocha tracks, paint stroke paths, tracker data.
- Layer styles, Essential Properties, preset pseudo effects missing in the target project (you get a warning).
- Several styles in one text when pasting **into** After Effects older than 2024.3 (the first style is kept, you get a warning).
- Faux bold, all caps, small caps, superscript/subscript on text in After Effects 2020 (read-only for scripts there).
- An environment light pasted in a comp whose 3D renderer does not support it becomes an ambient light (you get a warning).

## Good to know

- **Nothing runs in After Effects while you work.** The extension watches for Ctrl+C / Ctrl+V outside After Effects; After Effects only runs AECopy's script at that moment (no cursor flicker in Roto Brush or Paint). Dialogs (Composition Settings, Save...) no longer disconnect AECopy: a copy or paste waits until the dialog closes.
- **Not connected?** Click **Reload** (or right-click the tray icon > Reload): the extension reloads itself in every After Effects. If one stays *Not connected*, restart it (After Effects loaded before AECopy was installed, or extensions not allowed: step 3).
- **No placeholders:** if AECopy could not copy in the other After Effects, Ctrl+V of those layers is blocked (After Effects' own paste between two windows only gives placeholders / "no source" layers) and a message tells you what to do. Copying text (an expression...) between two After Effects still works.
- **Drag & drop** pastes into the open comp of the target After Effects, not at the exact drop point (scripts cannot know what is under the mouse). Dragging a window by its title bar never triggers it.
- **Quit** stops AECopy everywhere; it comes back with Windows or when you run it again.
- Log: tray icon > *Open log*, or the `mailbox` folder next to the exe. Tray icon > *Clear cache* > *Clear all* deletes the logs, temporary files and pasted images (settings are kept); *Clear log* and *Clear pasted images* delete only those. Images pasted next to a saved project are never deleted.
- Command line: `AECopy.exe --reload`, `AECopy.exe --quit`.

## Build from source

`build.ps1` compiles `AECopy.cs` with the C# compiler that ships with Windows (.NET Framework 4) and generates the icon. `AECopy.jsx` is the After Effects side (ExtendScript); `cep\` is the invisible extension that loads it.

---

## En français

**AECopy** : Ctrl+C dans un After Effects, Ctrl+V dans un autre (calques, effets, clés, compositions entières), entre deux fenêtres ou deux versions de 2020 à 2026. Aussi : glisser-déposer d'un After Effects à l'autre, et Ctrl+V d'une image copiée ailleurs.

> Fait avec l'aide de l'IA. Beaucoup testé mais pas fiable à 100 % : gardez une sauvegarde de vos projets importants et signalez ce qui ne se colle pas bien ([Issues](../../issues)).

- **Installer** : dézipper la Release dans un dossier où elle restera (ex. `C:\Tools\AECopy`, pas Téléchargements), en gardant `AECopy.exe`, `AECopy.jsx` et le dossier `cep` ensemble ; cocher *Allow Scripts to Write Files and Access Network* dans chaque After Effects ; autoriser les extensions non signées (commande PowerShell de l'étape 3 ci-dessus, une fois) ; lancer `AECopy.exe`, puis redémarrer After Effects.
- **Utiliser** : sélectionner, Ctrl+C dans un After Effects, Ctrl+V dans l'autre. Dans le même After Effects, rien ne change.
- **Options** : *Start with Windows*, *Drag & drop*, *Paste images*, *Fit to comp size* (adapte calques d'effets, solides, positions, points d'effets et masques à une comp d'une autre taille).
- **Rien ne tourne dans After Effects pendant que vous travaillez** : pas de clignotement du curseur en Roto Brush / Paint, et les boîtes de dialogue ne déconnectent plus AECopy.
- **Ne passe pas** : données internes de certains effets (Courbes, Mocha, tracés de Paint…), styles de calque, Essential Properties, plusieurs styles dans un texte collé vers un After Effects antérieur à 2024.3.
- **Pas connecté ?** Bouton **Reload** ; sinon redémarrer cet After Effects.

MIT License · [ilhanturan.fr](https://ilhanturan.fr)
