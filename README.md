# Codex Glass Themes

[English](README.md) · [繁體中文](README.zh-TW.md)

Give Windows Codex a glass background, your own colors, and local image wallpapers. **Install once, then launch Codex from its usual Start menu or taskbar icon.** A background helper applies the theme automatically.

**[Download the Windows x64 installer](https://github.com/mabyes1/codex-glass-themes/releases/latest)** · [Build from source](packaging/README.md)

This project targets **`ChatGPT.exe` inside the official `OpenAI.Codex` Windows package**. The package identity matters: a different app with the same executable name is not supported. This is an independent community project, unaffiliated with OpenAI.

## What you can customize

- Clear glass, color gradients, or a local background image.
- Six color presets, with separate controls for the base color and two accents.
- Background strength, blur, image shading, and reading comfort.
- A control that keeps text and buttons opaque while the background is transparent.
- A built-in button to restore Codex's original appearance.

Preferences persist in your existing Codex browser profile. Images are stored locally in IndexedDB. PNG, JPEG, WebP, and AVIF are supported, up to 12 MB per image. The installer and theme panel currently use Traditional Chinese; the instructions below include the relevant button labels.

## Requirements

| Requirement | Supported configuration |
| --- | --- |
| Operating system | Windows 11, build 22621 or newer |
| Architecture | x64; ARM64 is not supported by this installer |
| App | Official Windows Codex, package `OpenAI.Codex` |
| Account | Install while signed in to the Windows account that uses Codex |
| Runtime | Bundled Node.js; no separate Node.js or npm installation is needed |

Installation runs as the current user and does not request administrator elevation. Windows policies that block PowerShell, package debugging, or scheduled tasks may prevent installation. The installer checks the environment and reports conflicts before enabling the helper.

## Install and use

1. Install the official Windows x64 Codex app first.
2. Download `ChatGPT-Glass-Themes-Setup-1.0.0-win-x64.exe` from [Releases](https://github.com/mabyes1/codex-glass-themes/releases/latest).
3. Run it using your normal Windows account and click **「安裝並啟用」** (Install and enable). The default folder is `%USERPROFILE%\CodexGlass`.
4. If Codex was already running, finish your work and **fully quit it once**, then reopen it from its usual icon. Closing a window may leave the app running in the background.
5. Click **「佈景」** (Theme) near the top of the Codex window. Choose **「清透」** (Clear), **「配色」** (Colors), or **「圖片」** (Image).

![Installer window showing the install folder and Install and enable button](docs/images/installer.png)

After installation, the helper starts automatically when this Windows account signs in. It watches for Codex and applies your saved appearance. **You can keep using the official Codex icon; a separate theme launcher is no longer part of the normal workflow.** Keep the installation folder in place while using the tool.

The installer is currently unsigned, so Windows may display an unknown-publisher warning.

### Already using an earlier helper?

Use that installation's removal function first, then install this release. The installer preserves another helper's startup or debugger settings and reports a conflict instead of replacing them. A development checkout that used the older administrator-level IFEO hook should also use its original restore script before migrating.

## Updates and compatibility

**Official Codex updates:** the helper queries Windows for the installed package and its actual location every five seconds. When the package changes, it releases the previous callback and registers one for the new package. Package versions and installation drives are discovered at runtime. Old version aliases are kept separate, including aliases whose update target has disappeared.

If you open Codex immediately after an update, it may start before the next synchronization. Wait a few seconds, fully quit, and reopen it if the theme is missing. Future changes to Codex's startup mechanism, Chromium internals, or interface structure may require an update to this tool; compatibility with every future version cannot be guaranteed.

**Theme tool updates:** v1.0.0 uses uninstall-and-reinstall. Remove the installed theme tool through Windows Settings, then run the newer installer. Your theme preferences and image stay in the Codex profile. There is no automatic updater for this tool yet.

## Uninstall or restore the appearance

To temporarily use the original interface, open the theme panel and click **「還原 Codex 原始外觀」** (Restore original appearance). The background helper remains installed.

To remove the tool, open **Settings → Apps → Installed apps → ChatGPT Glass Themes（Codex） → Uninstall**. This stops the owned helpers, removes the package callback and login startup entry, and removes the installation files. Theme preferences and the saved image remain in Codex's browser storage.

Uninstall before moving or manually deleting the installation folder so Windows can release the startup callback correctly.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Installed successfully, but no Theme button | Fully quit Codex once and reopen it. The callback applies to a fresh app process. |
| Another helper or debugger is detected | Remove it using its original uninstaller or restore script, then retry. |
| Installation path is too long | Use a shorter, empty folder inside your own Windows profile, such as `%USERPROFILE%\CG`. |
| Theme disappears after an official update | Wait a few seconds, fully quit, and reopen. If it persists, check the logs below. |
| Helper files were moved or deleted | Restore them to the installed path, then use the uninstaller. Avoid deleting package debugger registry entries by guesswork. |

Diagnostics are inside the installation folder:

- `.runtime-auto/auto.log`: helper activity and errors.
- `.runtime-auto/package-hook-status.json`: callback state and package version. `armed` means it is ready for the next fresh launch.
- `.runtime-auto/live-acceptance.json`: the last observed app process with a working renderer, the original profile, and the theme mounted. Its timestamp matters; it is not a continuous health guarantee.
- `.runtime-auto/host-error.log`: theme-host errors.

For a read-only environment check, use PowerShell:

```powershell
$setup = '.\ChatGPT-Glass-Themes-Setup-1.0.0-win-x64.exe'
& $setup --check-only --install-root "$env:USERPROFILE\CodexGlass"
```

When [reporting an issue](https://github.com/mabyes1/codex-glass-themes/issues), include your Windows build, Codex version, theme-tool version, and the relevant error. Review logs before sharing them: they can contain local paths, process details, and package information.

## How it works and what it changes

The installer registers a **per-user background helper**, not a Windows service. A temporary, limited scheduled task starts it independently during installation and is then removed. Subsequent sign-ins use the current user's `CodexGlassThemeAutoAttach` startup entry.

The helper uses Windows `IPackageDebugSettings` to receive a callback when the official package starts. A compiled helper validates the package, user, executable, process creation time, and initial thread, adds `--remote-debugging-port=0` within the existing startup argument buffer, and resumes the process. A short directory junction points to the official package to fit that buffer. The theme host discovers the local CDP listener and styles the main renderer.

The official executable and package files remain unchanged. The app continues using its original Codex browser profile; the installer does not bundle the author's accounts, chats, preferences, images, or registry backups. CDP is a powerful debugging interface: the intended listener is local loopback, and the tool does not publish it to the network.

Windows package debugging also changes package suspend/resume/termination behavior while enabled. This is not an official theme extension API. See [Microsoft's package debugging documentation](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ipackagedebugsettings-enabledebugging) and the [source/build guide](packaging/README.md) for the implementation and recovery boundaries.

## Verification status

The original implementation passed a real cold launch on the development machine: the official app entry opened a working renderer, CDP and the theme attached automatically, and the existing colors and image were restored from the original profile.

The distributable installer passed extraction and isolated file deployment, bundled runtime and native helper checks, existing-installation protection, recovery from an update's dangling junction, and removal without following the junction into the official package. **A full install/launch/uninstall on a second clean Windows computer is still pending.** These checks do not establish compatibility with all PCs or future Codex releases.

## Source and bundled software

The installer, callback helpers, theme assets, and focused tests are in this repository. See **[Building and testing](packaging/README.md)** for the source layout and commands. The installer includes unmodified [Node.js 24.21.0 for Windows x64](https://nodejs.org/dist/v24.21.0/); its license and third-party notices are installed as `runtime/NODE-LICENSE.txt`.
