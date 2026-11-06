# FFR Edit

A Final Fantasy Resonance save editor for Decky Loader, Steam Deck and Linux Steam Machines. Android and local web clients use the same save service. This is an initial 0.1.0 port; it has automated synthetic-save coverage but still needs in-game validation on a real save.

## Install

Download **FFR_Edit.zip** from [Releases](https://github.com/timekillr/FFR_Edit/releases/latest). In Decky Settings → Developer → Install Plugin from ZIP, choose the ZIP (or use its release URL). Restart Decky if prompted. The complete ZIP includes its Node runtime: no system Node or Python packages need installing.

The plugin scans Steam libraries, including libraries on SD cards listed in `libraryfolders.vdf`, Flatpak Steam and Snap Steam. It finds `steamapps/compatdata/3259780/pfx/drive_c/users/*/AppData/Local/FFRS` and lists every account and slot with its full path and date. Use **Saves → Custom save folder** for unusual Proton prefixes. Autosave is labeled separately.

## Edit

1. Close the game. Open FFR Edit from Decky's Quick Access menu.
2. Scan for saves, select a slot, then confirm opening it. Opening creates a snapshot if the current version has not already been backed up.
3. Choose a section and search by character, Vision, item name or field. Use the Steam keyboard for number entry. All controls use Decky UI for controller navigation; long field lists are paged.
4. Changes stay staged until **Save changes → Confirm save to disk**. Reopening/reloading asks before discarding edits. The backend always checks for an unchanged file and a closed game immediately before replacing it.

Sections cover records, character stats/equipment IDs, per-character Vision MRP, Awakening, inventory, artifacts, map fields/positions, journal and bestiary values present in the save. Text/enum fields, structural IDs and story/scenario counters are read-only in this first port. Add known items by name, max all existing Vision mastery entries, or awaken all existing Visions. This is a port of the upstream parser and save codec with new Decky/companion interfaces; it does not reproduce every specialized desktop screen or quest/map shortcut.

Changing EXP/MRP may require an in-game recalculation of stats/abilities. Finish the Moogle of Light awakening tutorial before awakening every Vision. Prefer testing a spare slot. Steam Cloud can overwrite local changes; if it does, temporarily disable Cloud for this game while editing and resolve the later sync prompt deliberately.

## Backups and restore

- Automatic snapshots when opening a new revision, before every edit, and before every restore.
- **Back up this save now** and **Back up all saves now** create manual backups.
- **Backups** lists dated backups for the open slot; select one and confirm restore. The replaced version is backed up first.
- Backups include SHA-256 metadata. A damaged backup, parser error, stale revision, failed backup or failed validation aborts the write. Writes use a same-directory temporary file, fsync and atomic replace while preserving file ownership/mode.
- Backups and pairing survive plugin updates in Decky's `settings/ffr-edit/saves/backups` and `settings/ffr-edit/companion` folders. They are never pruned automatically. Keep an external copy too if reinstalling SteamOS or deleting Decky settings.

## Android and browser companions

Install the APK from [FFR_Edit_Companion](https://github.com/timekillr/FFR_Edit_Companion). In Decky open **Connection**, enable **Phone & web companion**, and create a six-digit pairing code. Connect to the displayed address on your home network and compare the certificate fingerprint during Android pairing.

For a browser, open the `https://<machine>:52882/` address shown in Decky. Compare the browser certificate SHA-256 fingerprint with Decky before trusting the local self-signed certificate, then enter a fresh pairing code. No public website or port forwarding is needed. The web assets are bundled with the plugin and also included in the companion repository.

Pairings are remembered. Reconnect retries stop after ten seconds; use Connection → Reconnect/Disconnect. Writes are never automatically retried. Each client keeps its own staged edits and uses a SHA-256 revision precondition, so a save made elsewhere requires a reload. All saves/backups live on the machine running Decky; no cloud account/server is involved. The optional HTTPS listener uses port **52882**, so Value Forge can run alongside it on 52881. Disable the listener or revoke devices in Decky at any time.

## Build and test

```sh
npm ci
npm run typecheck
npm run build
npm test
python3 scripts/fetch_node.py
npm run package
```

`fetch_node.py` downloads the pinned official Linux x64 Node runtime and validates it against Node's published SHA256SUMS. Releases bundle its license and this repository's complete corresponding source. Steam Deck and x86_64 SteamOS/Linux are the supported targets; ARM is not supported by this package.

Tests use a synthetic encrypted GVAS fixture, never a user's save. Coverage includes internal/external-library discovery, symlink handling, exact int64 values, invalid edits/checksums, backup failures, restore, revision conflicts and companion authorization. A real-save test can be run read-only with `python3 scripts/check_save.py /path/GameSaveData1.sav`. Final in-game load and hardware/gamepad checks are still required.

## Credits and licenses

Based on [FFR Save Editor](https://github.com/jesus-seijas-sp/ffr-save-editor) by Jesús Seijas (MIT), pinned in `THIRD_PARTY.md`. Parser and crypto remain in `vendor/`. Encryption research/data also credit zabo-dev's FFR Save Tracker. Companion transport is adapted from timekillr's Value Forge projects (GPL-3.0); this combined project is GPL-3.0-only. Original notices are included. No game art, audio or fonts are distributed. The upstream JSON game-data tables are retained for names and progression; game content belongs to Square Enix. Unofficial; not affiliated with Square Enix.
