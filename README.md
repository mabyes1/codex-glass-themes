# Codex Glass Themes

**Soft glass. Your colors. A whole ocean of ideas.**

[English](README.md) · [繁體中文](README.zh-TW.md) · [Download v1.2.0](https://github.com/mabyes1/codex-glass-themes/releases/tag/v1.2.0) · [Build the latest source](packaging/README.md)

Make the Windows Codex app feel like your workspace. Choose clear glass, a favorite image, a quiet aquarium, or the Milky Way. Keep text readable, save your preferences, and launch Codex from its usual icon.

![Codex running the deep-sea aquarium, with a demo document and the real theme controls](docs/images/aquarium.png)

*The actual Windows Codex app, showing a [demo document](docs/demo.md). Four ocean scenes, adjustable fish density, and a pause control live in the theme panel.*

> **Source and download are different.** These screenshots show the latest, unreleased source. The published **v1.2.0 installer is from October 7, 2026** and does not include Cosmos, Windows 10 compatibility, or the latest startup-recovery fixes. Build from source for those changes. A new stable installer has not been published.

## Make it yours

| Mode | What it brings |
| --- | --- |
| **Clear** | A neutral glass workspace with adjustable background strength. |
| **Colors** | Six palettes, from warm cream and matcha to deep blue and lilac, plus three editable colors. |
| **Image** | Your own PNG, JPEG, WebP, or AVIF wallpaper, stored locally; up to 12 MB per image. |
| **Aquarium** | Four deep-sea scenes, sixteen fish species, 14–90 swimming slots, bubbles, and a pause switch. |
| **Cosmos** | A generated Milky Way with twinkling stars, drifting dust, and occasional comets. |

### Warm mornings or late-night galaxies

![The real color controls in Codex, showing six palettes and the warm cream preset](docs/images/colors.png)

*Six starting points, your own finishing touches. Background strength and reading surfaces are separate controls.*

![The real Cosmos controls over the animated Milky Way background](docs/images/cosmos.png)

*Cosmos has its own night-strength and pause settings. Conversation content is hidden in these two controls screenshots for privacy; the background and panel are captured from the running app. [Screenshot notes](docs/images/README.md).*

Animations pause when you switch away, hide the window, pause them manually, or enable reduced motion. Aquarium rendering is capped at 24 FPS; Cosmos at 18 FPS. The aquarium is a fantasy scene mixing freshwater and marine animals. Its environment and fish artwork are AI-generated; the [art prompts](docs/art/) are included.

## Get started

You need the official **Windows x64 Codex package, `OpenAI.Codex`**, installed for the account that will use the theme.

| Version | Windows support |
| --- | --- |
| **Latest source** | Windows 10 22H2 / Windows 11, build 19045+. Builds below 22621 use an opaque renderer with simulated glass. |
| **Published v1.2.0 installer** | Windows 11 x64, build 22621+. This older installer does not contain the Windows 10 fallback. |

Windows 11 build 22621+ uses native background effects. On older supported builds, the compatibility mode softens the theme inside the window; it does not blur the desktop. ARM64 is not supported by this installer.

1. [Download the published installer](https://github.com/mabyes1/codex-glass-themes/releases/tag/v1.2.0), or [build the latest source](packaging/README.md) for the features shown here.
2. Run the installer under your normal Windows account. Click **「安裝並啟用」** — Install and enable. The default folder is `%USERPROFILE%\CodexGlass`.
3. If Codex was already running during installation, finish your work and **fully quit it once**, then reopen it from its usual Start menu or taskbar icon.
4. Click **「佈景」** — Theme — near the top of the window. Choose a mode and make it yours.

The installer includes Node.js; end users do not need developer tools. It runs without administrator elevation and is currently unsigned, so Windows may show an unknown-publisher warning. Keep the installation folder in place while using the theme.

Already using another version or a development helper? Remove it with its own uninstaller or restore script first. The installer reports conflicting startup/debugger settings instead of overwriting another installation.

## A few useful controls

- **Keep text and buttons opaque:** adjust the background without fading the foreground. Turning this off enables whole-window opacity, including text.
- **Reading comfort:** adds coverage behind content, cards, and the composer.
- **Restore original appearance:** removes the current theme immediately while leaving the helper installed.

Preferences stay in the existing Codex browser profile. Wallpaper data stays in local IndexedDB. This project does not provide a hosted wallpaper service or upload your chosen image.

## Updates and removal

The helper discovers the installed Codex package and checks for updates every five seconds. New source builds start the helper at sign-in and include a one-minute recovery trigger if it exits. A process that started before the callback was ready may still need one full close/reopen; that diagnosis should be based on missing CDP arguments, not a slow-loading window.

Theme-tool updates currently use **uninstall, then reinstall**. Open **Settings → Apps → Installed apps → ChatGPT Glass Themes（Codex） → Uninstall**, then install the newer build. Saved preferences and wallpaper remain in Codex's profile. Uninstall before moving or deleting the installation folder.

## If the theme is missing

The latest source retries a temporarily missing native window and can retry again when the window becomes active. Check the actual state before restarting Codex:

| Diagnostic file in `.runtime-auto/` | What to look for |
| --- | --- |
| `watcher-health.json` | A recent timestamp and a live helper PID. An old `armed` file alone does not prove the helper is running. |
| `attach-status.json` | Whether it is waiting for CDP, the main page, the theme, or the native background; native failures are recorded separately. |
| `host-error.log` | The failed native command and retry messages. |
| `startup-trace.jsonl` | Which startup phase took time. |

If the running process really lacks its CDP startup argument, wait until the helper is armed, finish your work, fully quit, and reopen. Reinstalling or restarting repeatedly will not explain a failed native request. [Startup investigation and verification](docs/startup-recovery.md).

When [reporting a bug](https://github.com/mabyes1/codex-glass-themes/issues), include the Windows build, Codex version, source/release version, and the relevant error. Review logs before sharing them; they can contain local paths and process details.

## What is verified

The October 19 source changes passed **31 Node tests**, real Chromium panel interactions under both appearance policies, a real scheduled-task recovery test, and isolated official-package activation with CDP/renderer checks. On the development PC, the existing Codex process was preserved and the native background returned to a working state. See the [verification boundaries](docs/startup-recovery.md#verification).

**Still pending:** a complete post-fix sign-out/sign-in and normal cold-launch cycle, and a clean install/launch/uninstall on another Windows 10/11 computer. Browser tests use a stubbed native bridge and do not establish real Windows 10 behavior. The current source is a development snapshot.

## Under the glass

This is an independent community project, unaffiliated with OpenAI. It targets `ChatGPT.exe` inside the official `OpenAI.Codex` package; another app with the same executable name is not supported.

A current-user helper uses Windows package-debug callbacks to add a loopback CDP argument on fresh activation. The theme host styles the main renderer and applies the native window effect when supported. Official package files are not patched. Package debugging changes Windows suspend/resume/termination behavior while enabled; [Microsoft documents that behavior](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ipackagedebugsettings-enabledebugging).

Source layout, build commands, rollback boundaries, and the bundled Node.js license are covered in **[Building and testing](packaging/README.md)**.
