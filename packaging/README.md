# Building and testing

[User guide](../README.md) · [繁體中文](#繁體中文)

## Build the Windows x64 installer

Use a Windows x64 development machine with Windows PowerShell 5.1 and the .NET Framework 4.x C# compiler at `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`. These are build requirements; end users receive a self-contained installer with the runtime included.

Run from the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File packaging/Get-NodeRuntime.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File packaging/Build-Installer.ps1 -Version 1.1.2
```

`Get-NodeRuntime.ps1` downloads the official Node.js 24.21.0 Windows x64 archive over HTTPS, compares the official checksum manifest with the pinned SHA-256, verifies the archive, and extracts it into `packaging/vendor`. Run it once for a fresh checkout; reuse the verified cache for later builds. Changing the runtime requires updating the fetch script, build manifest, and installer test together.

The build compiles the package callback, COM session, native backdrop helper, and WinForms installer. It stages only `packaging/payload` plus the bundled Node executable and license. PowerShell files in the staged payload receive a UTF-8 BOM for Windows PowerShell 5.1. A per-file integrity manifest is embedded with the payload.

Output: `dist/ChatGPT-Glass-Themes-Setup-1.1.2-win-x64.exe`. Each build has a separate staging directory under `packaging/build`. Neither building nor extracting registers a startup callback or changes a running Codex installation.

## Source layout

| Path | Purpose |
| --- | --- |
| `packaging/Setup.cs`, `setup.manifest` | Current-user WinForms installer and embedded-payload extraction |
| `packaging/payload/Setup-Theme.ps1` | Environment checks, install ownership, activation, rollback, and removal |
| `packaging/payload/Start-Theme-Auto.ps1` | Login helper, package synchronization, and theme-host startup |
| `packaging/payload/Package-Theme-Hook.ps1` | Per-user package callback registration and cleanup |
| `packaging/payload/PackageStartupDebugger.cs`, `StartupArguments.cs` | Validated startup argument update and native resume |
| `packaging/payload/PackageDebugSession.cs` | Windows package debug-session lifetime |
| `packaging/payload/New-CodexArgumentAlias.ps1` | Per-version short junction paths |
| `packaging/payload/theme/` | Renderer styles, panel, presets, CDP discovery, and native backdrop helper |
| `tests/` | Appearance and CDP discovery regression tests |

Runtime state (`.runtime-auto`, `.runtime`, `.arg`, ownership markers), user data, build caches, and binaries are excluded from Git. Publish the installer through GitHub Releases, rather than committing it to the source tree.

## Focused checks

For theme development, install a development Node.js version meeting `package.json`'s engine requirement. There are no npm dependencies to install.

```powershell
npm run check
npm test
npm run test:cdp
```

The appearance tests cover contrast, preset differences, neutral glass, image shading, and reading surfaces. The PowerShell tests check that CDP discovery selects the app's owned listener, rejects unrelated listeners and pet windows, and avoids occupied ports.

On Windows 11 x64 with the official Codex package installed, the installer harness performs isolated extraction/deployment and ownership/removal checks:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File packaging/Test-Installer.ps1
```

It uses a unique empty folder under the current user's profile and removes that staged installation on success. It does not activate the package callback or write the login startup entry. It records diagnostics under ignored `experiments/` and `dist/`. If it fails, its output identifies the remaining test folder for inspection. Full real-install acceptance requires a separate test machine or account and a fresh official app launch.

## Installer command-line modes

| Mode | Behavior |
| --- | --- |
| `--check-only [--install-root <path>]` | Validate the environment, payload, and conflicts; no persistent activation |
| `--extract-only <empty-directory>` | Extract the embedded payload without running the backend |
| `--stage-only --install-root <path>` | Deploy files and an ownership marker; no startup registration |
| `--silent [--install-root <path>]` | Perform the real installation without the GUI |
| `--uninstall [--silent] [--install-root <path>]` | Remove the owned installation |

For install/stage/removal, the path must be an ordinary dedicated directory inside the current user's profile. The backend rejects another installation's marker, an unrelated nonempty directory, conflicting callbacks, and an already completed install. Uninstall before reinstalling v1.1.2.

## Startup and cleanup boundaries

The startup helper uses `GetPackagePathByFullName` to resolve the actual official package location. Before updating startup arguments it verifies the expected package, image, current-user SID, process creation time, and initial thread. It never expands the existing argument allocation. Unsupported or invalid configurations use the native-start fallback where the process has been validated.

An installation marker binds removal to the product, account, and exact root. Cleanup only releases the callback with the matching helper/configuration command, preserving unrelated debugger registrations. Owned helpers stop before replacement. Junction removal unlinks the alias without traversing the official package target; unexpected reparse points cause removal to stop.

Windows package debugging changes package lifecycle behavior while active. Review [Microsoft's EnableDebugging documentation](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ipackagedebugsettings-enabledebugging) when changing this integration. The theme selector and DOM styles can also need adaptation after a Codex interface update.

## 繁體中文

### 建置安裝程式

開發環境需要 Windows x64、Windows PowerShell 5.1，以及 `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe` 的 .NET Framework C# 編譯器。一般使用者下載已建置的安裝包即可。

在倉庫根目錄執行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File packaging/Get-NodeRuntime.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File packaging/Build-Installer.ps1 -Version 1.1.2
```

第一個腳本以 HTTPS 下載官方 Node.js 24.21.0 Windows x64 ZIP，比對官方校驗清單與固定的 SHA-256，再驗證壓縮檔並解開至 `packaging/vendor`。新 checkout 執行一次即可，之後沿用已驗證的快取。若更換 Node 版本，請同步調整下載腳本、建置資訊與安裝器測試。

建置會編譯啟動回呼、COM session、原生背景助手及 WinForms 安裝器，只收錄 `packaging/payload` 與內附 Node 執行檔、授權。部署用 PowerShell 檔案加入 UTF-8 BOM，確保 Windows PowerShell 5.1 正確讀取中文。安裝內容包含逐檔完整性資訊。

產物是 `dist/ChatGPT-Glass-Themes-Setup-1.1.2-win-x64.exe`，每次建置使用獨立的 `packaging/build` 暫存目錄。建置與單純解包不會啟用回呼，也不會變更正在使用的 Codex。

### 目錄與驗證

`Setup.cs` 是圖形安裝器；`payload/Setup-Theme.ps1` 負責環境檢查、安裝、回復與移除；`Start-Theme-Auto.ps1` 管理登入助手。套件回呼與啟動參數處理位於 `Package-Theme-Hook.ps1`、`PackageStartupDebugger.cs`、`StartupArguments.cs` 與 `PackageDebugSession.cs`，短路徑由 `New-CodexArgumentAlias.ps1` 管理。主題、預設配色與原生背景助手都在 `payload/theme`。

主題開發需有符合 `package.json` 要求的 Node.js，不必安裝 npm 依賴：

```powershell
npm run check
npm test
npm run test:cdp
```

測試涵蓋配色對比、精選配色差異、清透／圖片／閱讀底色，以及 CDP 所屬程序、非主視窗排除與連接埠占用處理。

在已安裝官方 Codex 的 Windows 11 x64 上，可執行安裝器的獨立部署測試：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File packaging/Test-Installer.ps1
```

它使用目前帳戶個人資料夾內的唯一空白目錄，檢查解包、部署、既有安裝保護與移除邊界，成功後移除該測試安裝。過程不啟用套件回呼或寫入登入自啟。紀錄保存在 Git 已排除的 `experiments/` 與 `dist/`；失敗輸出會指出留下的測試目錄。真正安裝與官方入口冷啟動驗收，請使用另一台測試電腦或帳戶。

安裝器各模式見上方表格：`--check-only` 只檢查，`--extract-only` 解包，`--stage-only` 只部署，`--silent` 會實際安裝，`--uninstall` 移除。安裝與部署目錄必須位於目前帳戶的個人資料夾內。v1.1.2 完整安裝後若要重裝，先解除安裝。

### 回復與分發

移除程序以產品、帳戶與完整根目錄的 ownership marker 確認歸屬，只解除完整 helper／設定命令相符的回呼。junction 只解除連結，不遍歷官方套件；遇到非預期重新導向目錄會停止移除。啟動 helper 使用 Windows API 動態解析套件位置，核對程序後在既有參數容量內修改，無法適配時走已驗明程序的原生啟動回復。

執行狀態、別名、個人資料、建置快取與執行檔皆由 Git 排除。透過 GitHub Releases 分發安裝包，不要把開發帳戶的紀錄或資料目錄打包進去。套件除錯模式會改變 Windows 對應用程式的生命週期行為；修改相關機制前請閱讀 [Microsoft 文件](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ipackagedebugsettings-enabledebugging)。官方介面更新也可能需要調整主題樣式。
