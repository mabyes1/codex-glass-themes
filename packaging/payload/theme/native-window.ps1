param([ValidateSet('set','background','restore','status')][string]$Mode='status',[int]$Opacity=88,[ValidateSet('clear','acrylic')][string]$Backdrop='clear',[int]$CodexPid)
$ErrorActionPreference='Stop'
$nativeLibrary=Join-Path $PSScriptRoot 'ThemeWindow.dll'
if(Test-Path -LiteralPath $nativeLibrary){Add-Type -Path $nativeLibrary}else{
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'ThemeWindow.cs')))
}
if($CodexPid){
 $proc=Get-Process -Id $CodexPid -ErrorAction SilentlyContinue | Where-Object {$_.ProcessName -eq 'ChatGPT' -and $_.Path -match '\\OpenAI\.Codex_[^\\]+\\app\\ChatGPT\.exe$'}
}else{
 $main=Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" | Where-Object {$_.CommandLine -notmatch '--type=' -and $_.ExecutablePath -match 'OpenAI.Codex'} | Select-Object -First 1
 $proc=if($main){Get-Process -Id $main.ProcessId -ErrorAction SilentlyContinue}
}
if(!$proc){throw 'Codex is not running.'}
$stateDir=Join-Path $PSScriptRoot '.runtime'
$stateFile=Join-Path $stateDir 'native-original.json'
$start=$proc.StartTime.ToUniversalTime().ToString('o')
$saved=$null
if(Test-Path $stateFile){$saved=Get-Content $stateFile -Raw | ConvertFrom-Json}
$preferred=if($saved -and $saved.start -eq $start){[long]$saved.handle}else{0}
$handle=[ThemeWindow]::Find([uint32]$proc.Id,$preferred)
if(!$handle){throw 'Codex main window was not found.'}
$hw=[IntPtr]$handle
if($Mode -eq 'status'){
 @{handle=$handle;mode=$Mode;layer=[ThemeWindow]::Layer($hw);backdrop=[ThemeWindow]::Backdrop($hw)}|ConvertTo-Json -Compress
 return
}
New-Item -ItemType Directory -Force $stateDir | Out-Null
if(!$saved -or $saved.handle -ne $handle -or $saved.start -ne $start){
 $saved=@{handle=$handle;start=$start;style=[ThemeWindow]::GetStyle($hw,-20).ToInt64();layer=[ThemeWindow]::Layer($hw);backdrop=[ThemeWindow]::Backdrop($hw)}
 $saved|ConvertTo-Json|Set-Content $stateFile -Encoding utf8
}elseif(!$saved.PSObject.Properties['backdrop']){
 $saved|Add-Member -NotePropertyName backdrop -NotePropertyValue ([ThemeWindow]::Backdrop($hw))
 $saved|ConvertTo-Json|Set-Content $stateFile -Encoding utf8
}
if($Mode -eq 'set'){
 if($saved.backdrop -ge 0){[void][ThemeWindow]::SetBackdrop($hw,[int]$saved.backdrop)}
 $Opacity=[Math]::Max(55,[Math]::Min(100,$Opacity))
 $style=[ThemeWindow]::GetStyle($hw,-20).ToInt64()
 if(($style -band 0x80000) -eq 0){[void][ThemeWindow]::SetStyle($hw,-20,[IntPtr]($style -bor 0x80000))}
 if(![ThemeWindow]::SetLayeredWindowAttributes($hw,0,[byte][Math]::Round($Opacity*255/100),2)){throw 'Windows rejected window opacity.'}
}elseif($Mode -eq 'restore' -or $Mode -eq 'background'){
 if($saved.layer){$v=$saved.layer.Split(',');[void][ThemeWindow]::SetLayeredWindowAttributes($hw,[uint32]$v[0],[byte]$v[1],[uint32]$v[2])}
 else{[void][ThemeWindow]::SetLayeredWindowAttributes($hw,0,255,2)}
 if([ThemeWindow]::GetStyle($hw,-20).ToInt64() -ne [long]$saved.style){[void][ThemeWindow]::SetStyle($hw,-20,[IntPtr][long]$saved.style)}
 if($Mode -eq 'background'){
  $material=if($Backdrop -eq 'acrylic'){3}else{1}
  # The renderer's alpha surface can be recreated while DWM still reports the
  # requested material. Re-selecting the same value then leaves a black client
  # area until the user toggles Acrylic off/on. Force that transition ourselves.
  if($material -eq 3){
   if(![ThemeWindow]::SetBackdrop($hw,1)){throw 'Windows could not refresh the background material.'}
   [void][ThemeWindow]::DwmFlush()
  }
  if(![ThemeWindow]::SetBackdrop($hw,$material)){throw 'Background transparency requires Windows 11 build 22621 or newer.'}
 }elseif($saved.backdrop -ge 0){[void][ThemeWindow]::SetBackdrop($hw,[int]$saved.backdrop)}
 [void][ThemeWindow]::RedrawWindow($hw,[IntPtr]::Zero,[IntPtr]::Zero,0x185)
}
@{handle=$handle;mode=$Mode;layer=[ThemeWindow]::Layer($hw);backdrop=[ThemeWindow]::Backdrop($hw)}|ConvertTo-Json -Compress
