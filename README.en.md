# RimWorld Layout Planner (offline, local)

**Plan a RimWorld base in your browser — no game running, no internet — then run layout checks and export a real blueprint into the game.**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Dependencies](https://img.shields.io/badge/dependencies-none%20·%20pure%20frontend-orange.svg)
![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge%20%7C%20Firefox-brightgreen.svg)

[中文说明](README.md) · [Documentation](docs/) (Chinese)

![Planner UI](docs/images/hero.webp)

---

## What it is

A browser-based **layout planner for RimWorld bases**. Place buildings on the real grid footprint, run a pass of layout checks, then export a `.xml` blueprint you can drop back into the game.

- **Correct footprints** — 250×250 grid (configurable), `R` to rotate; multi-cell buildings (beds, tables, fabrication benches) change footprint with rotation
- **Room roles, derived like the game** — bedroom / barracks / kitchen / workshop… are inferred from what is inside the room (as `RoomRoleWorker` does); no manual tagging. Cooling targets are separate and estimated
- **Layout checks** — overlap · power network · room detection & role derivation · space rating · reachability · temperature estimate
- **Export to game** — real Blueprints-mod `.xml`, **including each building's material and rotation**; workers will build it for real
- **Import your save** — load an existing `.rws` colony as a backdrop and keep planning; it also reads the map **terrain/mountain**, **colonist skills**, **research progress** and **stored materials**
- **Terrain-aware checks** — marsh only has the Light affordance (walls need Heavy), water needs a bridge first, mountain rock must be mined
- **Workload estimate** — combines colonist skills, research prerequisites and stockpile to tell you whether a blueprint is feasible, how much material it needs and roughly how many in-game days it takes
- **Lock the backdrop** — save-imported buildings are locked by default (no accidental edits) and excluded from the blueprint export, so you only ship your new plan
- **Template library** — stop drawing the same standard bedroom forty times: save it once, then pick it and click the canvas to place it
- **Player home area** — reads `Area_Home` and draws it in green; stockpile counts default to the player area (switchable to whole-map)
- **Click room to locate** — clicking a room in the room list jumps the view to it
- **Auto-save** — your layout is saved to the browser as you work and restored on the next open
- **First-run import prompt** — on first launch the app asks once to import your RimWorld folder (with a "don't remind me" option); the import panel stays available
- **Chinese UI** — building and material names match the game (built-in table, or the official Simplified Chinese language pack if present)
- **Optional vanilla textures** — drop your RimWorld install folder into the page and the canvas shows the real game art; skip it and you get clean vector fallbacks

> **What it is not**: not a mod, it does not touch your game files, it does not go online, and it uploads nothing. Its only output is a blueprint file.

## Quick start

Pick one of three:

### 1. Try it online (zero install)

👉 **https://luwendi-qq.github.io/rimworld-planner/**

Fully functional. The only catch: you must drag in your RimWorld folder once if you want vanilla textures (they are cached locally in your browser).

### 2. Download the single-file build (recommended for daily use)

Grab `rimworld-planner.single.html` from [Releases](https://github.com/luwendi-qq/rimworld-planner/releases/latest) and **just double-click it**.

CSS and all JS are inlined into this one file — no external dependencies, roughly 630 KB, copy it anywhere.

### 3. Clone the source (follow updates / hack on it)

```bash
git clone https://github.com/luwendi-qq/rimworld-planner.git
```

Then pull future updates with:

```bash
git pull
```

Or click **Code → Download ZIP** on the repo page and overwrite your old folder.

> The `img/` textures are **not** in this repository (licensing — see below), so a fresh clone shows vector art. **Everything still works.** To get vanilla visuals, see [docs/textures.md](docs/textures.md) — it is a one-time local step.

## Highlights

| Feature | Notes |
| --- | --- |
| **Smart draw modes** | Walls/fences/sandbags → **rectangle outline**; doors/furniture/benches → **single cell**; floors → **fill**. Matches the game, no manual switching |
| **Never silently overwrites** | Drawing onto an existing building is blocked ("delete that tile first") instead of quietly replacing your plan; conduits can still go under walls and coolers / wall lamps can share a tile with a wall |
| **Auto-connecting conduits** | Conduits draw connections toward their neighbours; a lone tile becomes a junction box |
| **Per-item materials** | 53 stuffs (wood/stone/metal/fabric/leather), long-press to pick, remembered per building — and imported from your save |
| **Room roles** | Derived from the room's contents using the game's `RoomRoleWorker` rules (bed / stove / workbench / table / shelf…). Beds can be toggled normal / medical / prisoner in the inspector |
| **Temperature estimate** | Set a target temperature per room (planner-only); coolers/heaters are estimated with `ceil(area × ΔT ÷ 630)` |
| **Template library** | Save a selection as a named template (standard bedroom, dining room…), then pick it and click the canvas to place it instead of drawing it dozens of times |
| **Layout checks** | Power network via the game's 6-tile connection rule; room flood-fill with the game's space-rating thresholds; outdoor reachability via BFS |
| **Export image** | "Export image" saves the whole layout (auto-fitted to its bounding box) as a PNG — handy for sharing |
| **Standard editing** | Marquee select, multi-select, drag to move, copy/paste, delete, undo/redo (incremental, 200 steps, no memory blow-up on big bases) |
| **Favourites / recent** | Two extra tabs in the item bar (★ Favourites, 🕘 Recent) so the stuff you use most is one click away |
| **Auto-save** | Your layout is saved to the browser as you work and restored on the next open — a crashed tab no longer means losing everything |
| **Search** | By Chinese name, English name, or def id |

Full manual → [docs/usage.md](docs/usage.md) (Chinese)

## Changelog

Newest first, highlights only; the full log (with debugging details and test data) is in [CHANGELOG.md](CHANGELOG.md) (Chinese).
Every update is auto-built and published to [Releases · latest](https://github.com/luwendi-qq/rimworld-planner/releases/latest).

| Date | Change |
| --- | --- |
| 2026-10-26 | **Mod building import**: drop `Mods/`, Steam Workshop `294100/`, or a single mod folder — buildable buildings and textures from each mod are scanned in, a "🧩 模组" tab appears in the palette, and the exported blueprint's `<meta>` lists only the mods actually used. Also verified that Blueprints maps buildings from any mod → [notes](docs/blueprints-mod-support.md) |
| 2026-10-26 | **macOS fixes**: in the double-clicked single-file build, dragging folders under `file://` read no files (Chromium restriction) — now uses entry-first collection with directory sniffing and clear guidance; Core textures are picked up from `RimWorld.app/Contents/MacOS/Assets.zip`; undecodable textures fall back to vector icons instead of breaking rendering |
| 2026-10-21 | Fixes from a "20 days of fully autonomous AI play" retrospective: freezer target temperature, existing buildings blocking checks, automatic material picking, issue source labels, planned-vs-existing rendering |
| 2026-10-20 | CLI entry point `node tools/plan.js`: save → plan → checks → game-side `build()` calls, for AI / scripts → [docs/for-llm.md](docs/for-llm.md) (Chinese) |
| 2026-10-20 | Major planner update: room roles, temperature, power, paste templates, AI briefing / AI plan import |
| Earlier | Initial version and early iterations — see [CHANGELOG.md](CHANGELOG.md) |

## Screenshots

### Layout check: power network

![Power network](docs/images/power.webp)

Turn on the **电力网 (power grid)** layer to see the wiring: **thick yellow lines are conduit trunks, thin lines are devices joining the grid**.
The 运行校验 (Run checks) button also reports each grid's generation / draw / storage balance, plus every room's area, space rating, door count and cooler coverage.

### Vanilla textures vs vector fallback

Same area: the top image uses the game's vanilla textures, the bottom one is the vector fallback you get without `img/`.
**Shapes, footprints and rotations are identical** — only the game art is missing:

![Vanilla textures](docs/images/textures-on.webp)

![Vector fallback](docs/images/textures-off.webp)

## Getting the blueprint into the game

Click **导出蓝图 (Export blueprint)** in the top bar to get a `.xml`, then drop it into your Blueprints folder:

| Platform | Path |
| --- | --- |
| Windows | `%USERPROFILE%\AppData\LocalLow\Ludeon Studios\RimWorld by Ludeon Studios\Blueprints\` |
| Linux | `~/.config/unity3d/Ludeon Studios/RimWorld by Ludeon Studios/Blueprints/` |
| macOS | `~/Library/Application Support/RimWorld/Blueprints/` |

Load it in-game with the blueprint button; workers will consume materials and build it. Requires the **Blueprints** mod (for 1.7: `Blueprints - 1.7 Waylith (Unofficial)`, workshop ID `3819556044`).

> **Modded buildings work too.** The blueprint stores `defName` strings that the game resolves through `DefDatabase`, so any building/terrain/stuff from an active mod maps exactly like Core — there is no Core whitelist. The exporter fills `<meta>` with the mods actually used by the blueprint, and the only real requirement is that those mods are enabled when placing it. Evidence (upstream source + local 1.7 DLL) → [docs/blueprints-mod-support.md](docs/blueprints-mod-support.md) (Chinese).

> Handy: click **存入 Blueprints (Save into Blueprints)**, pick the folder once, and future exports write straight into it.

Details and save importing → [docs/import-export.md](docs/import-export.md) (Chinese)

> **Using mods?** Drag your `Mods` folder (or a single mod folder) into the "导入模组建筑" box on the right: the browser reads each mod's `About.xml`, only the Defs effective for your game version (supports `LoadFolders.xml` / `1.x/` folders), adds its buildable buildings to the palette (a "🧩 模组" tab appears) and decodes textures from the mod's own `Textures/`. Import your game folder first so `ParentName` inheritance resolves; mod data is cached in IndexedDB and restored automatically.
> Steam Workshop mods are **not** in `RimWorld/Mods` — they live in `steamapps/workshop/content/294100/`. Drag that whole `294100` folder in to import every subscribed mod at once (each subfolder name is the workshop ID); the panel has per-platform paths.
>
> On macOS the mods live in `~/Library/Application Support/RimWorld/Mods` (Steam Workshop items: `…/steamapps/workshop/content/294100/`), and — same as above — use the **选择模组文件夹** button instead of dragging when the page was opened from disk.

## Data accuracy (important)

The built-in database is **hand-curated reference data**: footprints are mostly reliable, but a few entries may drift between game versions. Those are flagged with `?` in the UI.

**Want exact numbers** (size / power usage / generation / storage straight from the game's `Defs`)?

- Easiest: drag your **RimWorld install folder** into the "导入游戏资源" box on the right — the browser reads everything itself. On macOS use the **选择游戏目录** button instead: browsers refuse to enumerate a dropped folder on `file://` pages. The folder is `~/Library/Application Support/Steam/steamapps/common/RimWorld`, and Core textures live inside `RimWorld.app/Contents/MacOS/Assets.zip` (the tool finds them automatically).
- Or run `python tools/extract_defs.py "<game folder>"` to generate `js/buildings.generated.js`.

Both routes **only read numbers from your own machine** — the output is a table of sizes and power values, and contains no game art.

Three ways to feed it data (including a low-bandwidth XML-only route) → [docs/data.md](docs/data.md) (Chinese)

## FAQ

<details>
<summary><b>The canvas shows only grey shapes, no game textures?</b></summary>

The `img/` textures are missing, so the tool falls back to vector art. Everything still works.
To get vanilla textures: drag your RimWorld install folder into "导入游戏资源" on the right, or run `tools/extract_textures.py`.
See [docs/textures.md](docs/textures.md).
</details>

<details>
<summary><b>The "save to browser" button does nothing?</b></summary>

Under `file://`, localStorage is restricted in some browsers (Firefox especially). Use **保存工程 (Save project)** in the top bar to export a file instead — same result, and safer.
</details>

<details>
<summary><b>Some buildings still show <code>?</code> after importing the game folder?</b></summary>

That building does not exist in the DLC set you own (or was removed in 1.7). The tool keeps the built-in reference values so you can still use it, and flags it with `?`.
</details>

<details>
<summary><b>How long does importing game resources take?</b></summary>

The first run takes tens of seconds to a minute or two, depending on how many DLCs you own. **Do not switch away from the tab** (browsers throttle background pages). Results are cached in IndexedDB and are available instantly next time.
</details>

More → [docs/faq.md](docs/faq.md) (Chinese)

## Running from source / contributing

No build step, no dependencies — just open `index.html` in a browser.

Rebuild the single-file version after changing source:

```bash
python tools/build_single.py
```

Run the tests (pure-logic assertions, Node's built-in test runner, no third-party deps):

```bash
node --test        # or: npm test
```

Code layout and each file's job → [docs/architecture.md](docs/architecture.md) (Chinese)

## Documentation

| Doc | What's in it |
| --- | --- |
| [docs/usage.md](docs/usage.md) | Drawing rules, item bar, room roles, templates, UI, shortcuts (Chinese) |
| [docs/checks.md](docs/checks.md) | How the checks actually work: power / rooms / temperature (Chinese) |
| [docs/import-export.md](docs/import-export.md) | Blueprint export, save import, Blueprints folder paths (Chinese) |
| [docs/data.md](docs/data.md) | Data accuracy and the three ways to extract defs from the game (Chinese) |
| [docs/textures.md](docs/textures.md) | The two ways to get vanilla textures and how faithful they are (Chinese) |
| [docs/architecture.md](docs/architecture.md) | Code layout, undo-stack design, tests (Chinese) |
| [docs/faq.md](docs/faq.md) | Frequently asked questions (Chinese) |
| [tools/README.md](tools/README.md) | What the three Python scripts do and what they need (Chinese) |
| [CHANGELOG.md](CHANGELOG.md) | What changed (Chinese) |

## Credits & licensing

- This project **contains no RimWorld game art**. `img/` and `js/sprites.js` are excluded via `.gitignore`
  and must be extracted locally from **your own copy of the game**. Screenshots in the README show the tool running.
- The default icons are **original vector art drawn in code**. Building names, grid sizes and power values are factual data used for compatibility.
- The blueprint `.xml` format follows the public implementation of the Blueprints mod (Fluffy, MIT).
  The bundled zstd decoder is [fzstd](https://github.com/101arrowz/fzstd) (MIT).
- RimWorld and related names are trademarks of Ludeon Studios. This is an **unofficial fan tool**.

## License

[MIT](LICENSE) — code and docs are free to use, modify and distribute (game art excluded).
