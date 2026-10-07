param([string]$Installer,[string]$Output,[string]$PreviewRoot='%USERPROFILE%\CodexGlass')
$ErrorActionPreference='Stop'
$repository=Split-Path -Parent $PSScriptRoot
if(!$Installer){$Installer=(Get-Content -LiteralPath (Join-Path $repository 'dist\build-result.json') -Raw -Encoding UTF8|ConvertFrom-Json).installer}
if(!$Output){$Output=Join-Path $repository 'dist\installer-preview.png'}
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing @'
using System;using System.Drawing;using System.Reflection;using System.Windows.Forms;
public static class InstallerPreview {
 public static void Render(string exe,string root,string output){
  var type=Assembly.LoadFrom(exe).GetType("SetupForm");
  var ctor=type.GetConstructor(BindingFlags.Instance|BindingFlags.NonPublic,null,new[]{typeof(string),typeof(string)},null);
  using(var form=(Form)ctor.Invoke(new object[]{root,"Install"}))
  using(var bitmap=new Bitmap(form.Width,form.Height)){
   form.StartPosition=FormStartPosition.Manual;form.Location=new Point(-20000,-20000);form.ShowInTaskbar=false;form.Opacity=0;
   form.Show();form.PerformLayout();Application.DoEvents();
   form.DrawToBitmap(bitmap,new Rectangle(0,0,bitmap.Width,bitmap.Height));bitmap.Save(output,System.Drawing.Imaging.ImageFormat.Png);form.Hide();
  }
 }
}
'@
[InstallerPreview]::Render($Installer,$PreviewRoot,$Output)
Write-Output $Output
