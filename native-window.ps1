param([ValidateSet('set','background','restore','status')][string]$Mode='status',[int]$Opacity=88,[ValidateSet('clear','acrylic')][string]$Backdrop='clear')
$ErrorActionPreference='Stop'
Add-Type @'
using System;using System.Runtime.InteropServices;using System.Diagnostics;
public class ThemeWindow {
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)]public struct Rect{public int L,T,R,B;}
 [DllImport("user32.dll")]public static extern bool EnumWindows(EnumProc cb,IntPtr p);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")]public static extern IntPtr GetStyle(IntPtr h,int n);
 [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW",SetLastError=true)]public static extern IntPtr SetStyle(IntPtr h,int n,IntPtr v);
 [DllImport("user32.dll",SetLastError=true)]public static extern bool SetLayeredWindowAttributes(IntPtr h,uint key,byte alpha,uint flags);
 [DllImport("user32.dll")]public static extern bool GetLayeredWindowAttributes(IntPtr h,out uint key,out byte alpha,out uint flags);
 [DllImport("user32.dll")]public static extern bool RedrawWindow(IntPtr h,IntPtr rect,IntPtr region,uint flags);
 [DllImport("dwmapi.dll")]public static extern int DwmGetWindowAttribute(IntPtr h,int attribute,out int value,int size);
 [DllImport("dwmapi.dll")]public static extern int DwmSetWindowAttribute(IntPtr h,int attribute,ref int value,int size);
 public static int Backdrop(IntPtr h){int value;return DwmGetWindowAttribute(h,38,out value,4)==0?value:-1;}
 public static bool SetBackdrop(IntPtr h,int value){return DwmSetWindowAttribute(h,38,ref value,4)==0;}
 public static long Find(uint pid){long best=0,area=0;EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);Rect r;if(id==pid&&IsWindowVisible(h)&&GetWindowRect(h,out r)){long a=(long)(r.R-r.L)*(r.B-r.T);if(a>area){area=a;best=h.ToInt64();}}return true;},IntPtr.Zero);return best;}
 public static string Layer(IntPtr h){uint k,f;byte a;bool ok=GetLayeredWindowAttributes(h,out k,out a,out f);return ok?String.Format("{0},{1},{2}",k,a,f):"";}
}
'@
$proc=Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" | Where-Object {$_.CommandLine -notmatch '--type=' -and $_.ExecutablePath -match 'OpenAI.Codex'} | Select-Object -First 1
if(!$proc){throw 'Codex is not running.'}
$handle=[ThemeWindow]::Find([uint32]$proc.ProcessId)
if(!$handle){throw 'Codex main window was not found.'}
$hw=[IntPtr]$handle
$stateDir=Join-Path $PSScriptRoot '.runtime'
New-Item -ItemType Directory -Force $stateDir | Out-Null
$stateFile=Join-Path $stateDir 'native-original.json'
$start=(Get-Process -Id $proc.ProcessId).StartTime.ToUniversalTime().ToString('o')
$saved=$null
if(Test-Path $stateFile){$saved=Get-Content $stateFile -Raw | ConvertFrom-Json}
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
 [void][ThemeWindow]::SetStyle($hw,-20,[IntPtr]($style -bor 0x80000))
 if(![ThemeWindow]::SetLayeredWindowAttributes($hw,0,[byte][Math]::Round($Opacity*255/100),2)){throw 'Windows rejected window opacity.'}
}elseif($Mode -eq 'restore' -or $Mode -eq 'background'){
 if($saved.layer){$v=$saved.layer.Split(',');[void][ThemeWindow]::SetLayeredWindowAttributes($hw,[uint32]$v[0],[byte]$v[1],[uint32]$v[2])}
 else{[void][ThemeWindow]::SetLayeredWindowAttributes($hw,0,255,2)}
 [void][ThemeWindow]::SetStyle($hw,-20,[IntPtr][long]$saved.style)
 if($Mode -eq 'background'){
  $material=if($Backdrop -eq 'acrylic'){3}else{1}
  if(![ThemeWindow]::SetBackdrop($hw,$material)){throw 'Background transparency requires Windows 11 build 22621 or newer.'}
 }elseif($saved.backdrop -ge 0){[void][ThemeWindow]::SetBackdrop($hw,[int]$saved.backdrop)}
 [void][ThemeWindow]::RedrawWindow($hw,[IntPtr]::Zero,[IntPtr]::Zero,0x185)
}
@{handle=$handle;mode=$Mode;layer=[ThemeWindow]::Layer($hw);backdrop=[ThemeWindow]::Backdrop($hw)}|ConvertTo-Json -Compress
