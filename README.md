# Codex Glass Themes

替 Windows 上的 Codex 桌面介面加上玻璃佈景、三色調色盤、自訂圖片，以及所有佈景共用的視窗透明度滑桿。

這是非官方的本機客製工具。透過本機 CDP 注入 CSS 和切換面板，不修改 Codex 安裝包，也不需要 npm 相依套件。

## 功能

- **藍紫玻璃**：保留第一版配色，可自由調整底色、左側光暈、右側光暈，一鍵還原。
- **桌面玻璃**：中性的亮面玻璃底色。
- **銀白亮面**：銀灰反光、清透亮邊。
- **自訂圖片**：本機 PNG、JPG、WebP、AVIF，最大 12 MB，另有圖片暗化滑桿。
- **共用視窗不透明度**：55–100%，換佈景沿用相同數值。
- **保持前景清晰**：開啟後改為調整背景不透明度（0–100%），文字、圖示與按鈕不使用整窗透明度。各佈景共用此設定。
- **清透／Acrylic**：前景清晰模式可選擇無模糊的清透背景，或 Windows Acrylic 背景。Acrylic 的模糊程度由 Windows 管理。
- **新對話輸入框**：與一般聊天輸入框套用相同的玻璃效果，包含自訂調色與圖片模式。
- **還原原始外觀**：恢復原來的主題與原生透明度；停止助手時也會還原。

關閉「保持前景清晰」時使用 Windows 的整個視窗透明度，文字、按鈕和面板會一起透明。開啟後，恢復原生視窗不透明度，透過 CDP 清除渲染器的預設底色，單獨調整佈景背景層的不透明度，搭配 Windows 的背景合成；前景內容保持原來的清晰度。背景不透明度與舊模式的視窗不透明度分別保存，切換模式不會覆蓋原設定。

## 需求

- Windows 11 與已安裝的 Codex 桌面版。
- 前景清晰模式需要 Windows 11 build 22621 或更新版本，以及能合成透明背景的 Codex 原生視窗；目前安裝版已確認可用。背景材質使用 [Windows DWM API](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type)。
- Node.js **22.15 或更新版本**，`node.exe` 可從 PATH 執行。
- Windows PowerShell 5.1，能執行下載後的本機腳本。
- 桌面執行檔會檢查 Codex 是否啟用本機 CDP；連接埠可以變動。若目前的 Codex 沒有 CDP，它會提示你先自行結束 Codex，不會強制關閉正在使用的視窗。

實際驗證的 Codex 版本是 **26.924.2738.0**，主程序名稱為 `ChatGPT.exe`，Microsoft Store 套件為 `OpenAI.Codex`。其他版本、安裝方式和作業系統尚未驗證。

## 啟動

1. 下載並解壓縮套件，或 clone 這個 repo。
2. 直接啟動桌面執行檔或 `Start-Theme-Switcher.cmd`。若 Codex 已開啟 CDP，會直接連線。若目前未啟用 CDP，請先送出或保存未完成的輸入內容，**自行結束 Codex**，再雙擊桌面執行檔啟動帶 CDP 的 Codex。可用下列命令只檢查目前是否需要重新啟動：

   ```powershell
   powershell -NoProfile -File .\Ensure-CodexCdp.ps1 -CheckOnly
   ```

   Microsoft Store 版本由桌面執行檔透過 Windows 套件啟動 API 帶入 CDP 參數；不要直接執行受保護的 `WindowsApps` 內的 `ChatGPT.exe`。這段啟動流程仍需在 Codex 完全關閉時實測。CDP 可控制應用程式，請維持在 loopback，不要公開到區域網路或網際網路。

3. 點選 Codex 右上角 **「◈ 佈景」**，選擇佈景、配色或圖片，再調整共用不透明度。
4. 想只讓背景透明時，開啟 **「保持前景清晰」**，調整 **「背景不透明度」**。開啟 **「模糊背後背景（Acrylic）」** 可使用毛玻璃；關閉則使用清透玻璃。

不需要 `npm install`。背景助手會在頁面重新載入或 Codex 重開、CDP 連接埠改變後重新連線，補上切換器。若新的 Codex 工作階段沒有啟用 CDP，需要自行結束它，再透過桌面執行檔啟動。AGENTS.md 可以提醒代理在新對話中檢查並接回佈景，但無法替已執行的 Electron 程序新增啟動參數，也不會在代理執行前改變畫面。未設定 Windows 開機自動啟動；同一台電腦請只執行一份助手。

## 建立桌面執行檔

在套件資料夾執行 `powershell -NoProfile -File .\Build-Desktop-Launcher.ps1`，會在桌面建立 **`Codex Glass Themes.exe`**。之後雙擊它即可啟動或接回切換器。執行檔會呼叫此套件資料夾內的 `Theme-Switcher.ps1`；若搬動套件，請重新執行建置命令。已執行中的助手會自行接回重開後的 Codex，通常無須再次點擊。

## 停止與還原

- 面板裡的 **「還原原始外觀」**：還原外觀，保留切換器。
- 雙擊 **`Stop-Theme-Switcher.cmd`**：停止助手，移除注入的介面，還原原生視窗樣式。
- 助手若被強制結束，可執行 `powershell -NoProfile -File .\native-window.ps1 -Mode restore` 還原視窗透明度，再重新載入 Codex 介面以移除樣式。請先還原再移除 `.runtime`，因為裡面有原始視窗樣式的備份。

## 本機資料

- 圖片存在 Codex 的本機 IndexedDB：`ken-glass-images`。
- 配色與偏好存在本機 localStorage：`ken-glass-preferences-v1`。
- 執行紀錄、PID 與原生視窗樣式備份存在套件內的 `.runtime/`，已排除 Git。
- 桌面執行檔的退出碼及輸出會寫入 `.runtime/launcher.log`，方便診斷啟動失敗。
- 不上傳圖片，不啟動額外網路伺服器，只連接本機 CDP。

停止助手不會清除儲存的圖片與偏好，方便下次繼續使用。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `theme-panel.js` | 注入式切換器、調色盤、圖片選擇與本機儲存 |
| `theme-host.mjs` | CDP 連線、重新連線與原生透明度橋接 |
| `native-window.ps1` | 調整 Codex 主視窗透明度／背景材質，保存並還原原始樣式 |
| `blue-glass.css` | 第一版藍紫玻璃備份 |
| `silver-glass.css` | 銀白亮面玻璃 |
| `Theme-Switcher.ps1` | 隱藏背景啟動／停止助手 |
| `find-codex-cdp.ps1` | 尋找目前 Codex 主視窗使用的本機 CDP 連接埠 |
| `Ensure-CodexCdp.ps1` | 檢查 CDP；若 Codex 未執行，帶 CDP 參數啟動 |
| `Start-PackagedCodex.ps1` | 透過 Windows 套件啟動 API 啟動 Store 版 Codex |
| `GlassLauncher.cs`、`Build-Desktop-Launcher.ps1` | 產生桌面單一啟動執行檔 |

## 驗證範圍

已在上述單機版本實際確認：佈景切換、三色調色與還原、跨佈景共用透明度、自訂圖片顯示和 IndexedDB 儲存、新對話輸入框在各佈景的效果、助手停止後原生視窗樣式還原、重新啟動助手後偏好保留，以及桌面執行檔接上變動後的 CDP 連接埠。此次另確認「目前 Codex 沒有 CDP」會被辨識為需要重開；從完全關閉狀態由桌面執行檔啟動 Codex 尚未在目前聊天中測試，以免中斷正在進行的工作。

介面選擇器依賴 Codex 的 DOM 結構，更新後可能需要調整。多個 Codex 主視窗目前不支援精確配對；請以單一主視窗使用。

修正 Windows PowerShell 5.1 讀取無 BOM UTF-8 中文腳本時的語法錯誤，以及背景助手繼承輸出管線後桌面 EXE 等不到 EOF 的問題。已用 Windows PowerShell 5.1 檢查 CDP，停止助手後由更新的桌面 EXE 重新啟動助手，確認 EXE 回傳 0，並透過 CDP 確認樣式、切換器與控制器已注入現有 Codex 視窗。

前景清晰模式已在 Windows build 26200 的現有 Codex 工作階段確認：網頁底色透明、背景層獨立淡化、文字與頁面容器 opacity 為 1，原生視窗不使用整窗 alpha；清透與 Acrylic 材質設定成功。原生樣式備份保留原本的 Mica 材質，停止助手時還原背景材質與 CDP 底色覆寫。桌面啟動器接回更新的助手已通過，Codex 完整退出後的啟動流程未於此次重跑。
