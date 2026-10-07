# ChatGPT Glass Themes

[English](#english) · [繁體中文](#繁體中文)

## English

Glass backgrounds, color presets, and local image wallpapers for `ChatGPT.exe` inside the official Windows Codex package (`OpenAI.Codex`). This is an independent community tool, unaffiliated with OpenAI.

### Install and use

1. Install the official Windows x64 Codex app first.
2. Run `ChatGPT-Glass-Themes-Setup-1.2.0-win-x64.exe` and click **「安裝並啟用」** (Install and enable).
3. If Codex is running, finish your work, fully quit it once, and reopen it from the usual Start menu or taskbar icon.
4. Click **「佈景」** (Theme) near the top of the window to select colors, a background image, or **「水族館」** (Aquarium).

The helper starts automatically when this Windows account signs in. The runtime is bundled; a separate Node.js installation is not required. The installer and theme panel currently use Traditional Chinese.

Requires Windows 11 x64, build 22621 or newer, and the official `OpenAI.Codex` package. Another app named `ChatGPT.exe` is not automatically supported. The installer reports unsupported environments before activation.

The default installation folder is `%USERPROFILE%\CodexGlass`. Keep it in place while using the tool. Remove an earlier helper with its original removal function before installing this version. For an older development version with an administrator-level IFEO hook, also run its original restore script before migrating.

The Deep Sea Glimmer aquarium combines a static AI-generated ocean background with ten generated fish species and small bubbles. The fantasy aquarium mixes freshwater and marine animals, keeping fourteen swimming slots and changing species beyond the edge. Animation is capped at 18 FPS and 960 × 640 pixels. Water opacity is saved separately. Use **「暫停游動」** to pause; animation also stops while the window is hidden, another theme is selected, or reduced motion is enabled.

### Uninstall, updates, and data

Open **Settings → Apps → Installed apps → ChatGPT Glass Themes（Codex） → Uninstall**. Removal stops owned helpers and removes the callback, login startup entry, and installation files. Theme preferences and images remain in the existing Codex browser profile. Uninstall before moving or deleting the installation folder.

Official package versions and installation locations are discovered dynamically every five seconds. Future startup or interface changes can still require a theme-tool update. If the theme is missing just after an official update, wait a few seconds, fully quit, and reopen Codex. Updating the theme tool itself currently requires uninstalling it and running the newer installer.

This package includes no author's account, chat, image, preference, or registry-backup data. It uses local CDP and a Windows package-debugging callback, leaving official package files unchanged. CDP is a powerful local debugging interface; package debugging also changes Windows package lifecycle behavior while active. This is not an official theme extension API.

The installer is unsigned; Windows may show an unknown publisher. The original implementation passed a live cold launch on the development machine. The distributable passed isolated deployment and cleanup checks; a full install/launch/uninstall on a second clean computer is still pending.

### Diagnostics and source

Inside the installation folder, `.runtime-auto/auto.log` records helper activity, `package-hook-status.json` reports callback status, and `live-acceptance.json` records the last observed app process with a working renderer, original profile, and mounted theme. Check timestamps when reading these files.

The installer's `--check-only` mode checks the environment without activation. `--extract-only <empty-directory>` extracts files; `--stage-only --install-root <empty-folder-inside-your-profile>` deploys files without startup registration. `--silent` performs a real installation.

Documentation, source, releases, and issue reporting: [mabyes1/codex-glass-themes](https://github.com/mabyes1/codex-glass-themes).

Bundled software: unmodified [Node.js 24.21.0 for Windows x64](https://nodejs.org/dist/v24.21.0/). The license and third-party notices are installed as `runtime/NODE-LICENSE.txt`.

## 繁體中文

為 Windows Codex 桌面版的 `ChatGPT.exe` 加上可選配色、圖片背景與玻璃效果。

## 安裝

1. 先安裝官方 Windows x64 Codex 桌面版。
2. 執行 `ChatGPT-Glass-Themes-Setup-1.2.0-win-x64.exe`，按「安裝並啟用」。
3. 如果 Codex 正在執行，完整退出一次，再使用原本的開始功能表或工作列圖示開啟。
4. 點視窗上的「佈景」，選擇配色、自己的背景圖片，或「水族館」。

背景助手會隨目前帳戶登入 Windows 自動啟動。安裝包已內附執行環境，使用時不必另外安裝 Node.js 或開發工具。

支援 Windows 11 x64，系統組建 22621 以上。目前辨識官方 `OpenAI.Codex` 套件；其他產品即使執行檔也叫 `ChatGPT.exe`，仍需另外適配。未支援的環境會在安裝前顯示原因。

安裝位置預設為 `%USERPROFILE%\CodexGlass`。這個資料夾包含背景助手與啟動回呼，使用期間請保留。若已安裝其他版本的自動主題助手，先用原安裝的移除功能解除，再安裝此版本。

若先前使用的是含管理員 IFEO 鉤子的開發版本，移轉前也請執行原版本的還原腳本。

「深海微光」水族館以 AI 生圖作為靜態海底背景，搭配十種生圖魚群與細小泡泡；這個幻想水族館混合淡水與海水魚，固定十四個游動位置，出畫面後才輪換魚種，上限為 18 FPS、960 × 640 像素，水色濃度獨立保存。「暫停游動」可留下靜態畫面；視窗隱藏、切換主題或系統啟用減少動態效果時，也會停止動畫。

## 解除安裝

到 Windows「設定 → 應用程式 → 已安裝的應用程式」，找到「ChatGPT Glass Themes（Codex）」並解除安裝。

解除安裝會停止背景助手、解除本套件的啟動回呼並移除登入自啟與程式檔案。個人的主題偏好及背景圖片保留在 Codex 自己的瀏覽器資料中。

## 更新與資料

助手會動態查詢官方套件位置，偵測版本變更後重新掛載，安裝程式不依賴特定官方版本號或磁碟位置。未來若官方改變啟動機制或介面結構，主題仍可能需要更新。

每個使用者都使用自己的原 Codex 資料目錄。安裝包不包含製作者的聊天、帳號、圖片、自訂偏好、登錄備份或執行紀錄。

本工具以本機 CDP 套用主題，未修改官方執行檔。它是獨立社群工具，並非 OpenAI 官方功能。安裝程式尚未做程式碼簽署，Windows 可能顯示未知的發行者。

## 執行環境與授權

內附未修改的 [Node.js 24.21.0 官方 Windows x64 執行環境](https://nodejs.org/dist/v24.21.0/)，授權與第三方聲明見 `runtime/NODE-LICENSE.txt`。

## 安裝診斷

安裝目錄的 `.runtime-auto/auto.log` 是背景助手紀錄；`package-hook-status.json` 表示回呼狀態，`live-acceptance.json` 記錄自動掛載主題且使用原資料目錄的實際實例。

技術人員可使用安裝程式的 `--check-only` 只檢查環境；`--extract-only <空目錄>` 解開內附檔案；`--stage-only --install-root <個人資料夾內的空目錄>` 測試檔案部署。後兩者不啟用啟動回呼或登入自啟。`--silent` 會實際安裝；請只在已授權的部署流程使用。
