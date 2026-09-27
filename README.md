# DarkSafari

Free, open-source dark mode for every website in Safari on **Mac, iPhone and iPad**.

- **Automatic.** Follows your system appearance, and switches live when it changes.
- **Leaves dark sites alone.** Sites that already have a dark theme aren't re-themed.
- **No white flash.** Pages start dark while they load.
- **Per-site control.** Turn it off (or on) for any site.
- **Gentle on images.** Photos and videos are dimmed slightly, which you can switch off.

DarkSafari is a userscript. It runs inside [Userscripts](https://github.com/quoid/userscripts), a free, open-source Safari extension. You don't need a paid app or an Apple Developer account. The theming engine is [Dark Reader](https://github.com/darkreader/darkreader)'s (MIT), bundled into the script.

## Install

1. Install [**Userscripts**](https://apps.apple.com/us/app/userscripts/id1463298887) from the App Store. The same free app works on Mac, iPhone and iPad.
2. Enable the extension in Safari:
   - **Mac:** Safari → Settings → Extensions → turn on Userscripts. Under "Permissions", allow it on **all websites**.
   - **iPhone/iPad:** Settings → Apps → Safari → Extensions → Userscripts → turn on, and set **All Websites** to **Allow**.
3. In Safari, open
   **https://raw.githubusercontent.com/joewolly/DarkSafari/main/dist/darksafari.user.js**,
   then click/tap the Userscripts toolbar button and choose **Install**.

That's it. Userscripts checks for DarkSafari updates automatically.

## Using it

Open the DarkSafari panel on any page:

- **Mac:** press **Ctrl + Option + D**
- **iPhone/iPad:** touch and hold the page with **two fingers** for about half a second

In the panel you can:

- **turn this site off or on.** Turning a site on also works for sites DarkSafari left alone because they looked dark;
- set the mode for all sites: **Auto** (follow the system), **On** (always dark) or **Off**;
- toggle **Dim images slightly**.

## Limitations

- Userscripts has to be allowed on all websites for DarkSafari to reach every page.
- Settings are saved asynchronously. When your system is in light mode but DarkSafari is set to **On**, pages can briefly flash light before they darken.
- Frames inside pages (embedded widgets, comments) aren't darkened.
- Userscripts has no menu-command API, which is why the panel opens with a shortcut or gesture instead of a menu item.

## Development

```sh
npm install
npm run build      # → dist/darksafari.user.js and dist/darksafari.meta.js
npm run typecheck
npm test           # builds, then runs Playwright tests in Chromium
```

| File | Role |
|---|---|
| `src/main.ts` | Decides whether to darken, starts/stops the engine, anti-flash, live updates |
| `src/detect.ts` | Detects pages that already look dark (measured with our styles switched off) |
| `src/settings.ts` | Settings stored with `GM.getValue` / `GM.setValue` |
| `src/fetch.ts` | Lets Dark Reader read cross-origin stylesheets via `GM.xmlHttpRequest` |
| `src/panel.ts` | The settings panel and its shortcut and gesture |
| `src/header.txt` | Userscript metadata block |

`dist/` is committed so the install link always points at a built script. Rebuild before committing source changes. To release, bump `version` in `package.json` and rebuild; Userscripts updates installed copies when the version goes up.

## Credits and license

MIT. See [LICENSE](LICENSE). DarkSafari bundles Dark Reader, which is MIT-licensed; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). DarkSafari isn't affiliated with Dark Reader, Noir or Apple.
