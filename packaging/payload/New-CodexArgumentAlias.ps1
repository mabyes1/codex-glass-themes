function New-CodexArgumentAlias {
    param([Parameter(Mandatory)]$Package)
    if($Package.PackageFullName -notmatch '^OpenAI\.Codex_[0-9.]+_x64__2p2nqsd0c76g0$'){throw 'Unsupported package identity'}
    $official=Join-Path $Package.InstallLocation 'app'
    $image=Join-Path $official 'ChatGPT.exe'
    if(!(Test-Path -LiteralPath $image) -or !(Test-Path -LiteralPath (Join-Path $official 'resources\app.asar'))){throw 'Official application layout is unsupported'}
    $root=Join-Path $PSScriptRoot '.arg'
    $marker=Join-Path $root 'argument-alias-owner.json'
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if(Test-Path -LiteralPath $root){
        if((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Argument alias root is a reparse point; it was preserved'}
        if(!(Test-Path -LiteralPath $marker)){throw 'Existing alias root has no ownership marker; it was preserved'}
        $owner=Get-Content -LiteralPath $marker -Raw -Encoding UTF8|ConvertFrom-Json
        if($owner.sid -ne $sid -or $owner.project -ne $PSScriptRoot){throw 'Existing argument aliases belong to another installation; they were preserved'}
    }else{
        New-Item -ItemType Directory -Path $root|Out-Null
        [IO.File]::WriteAllText($marker,(@{sid=$sid;project=$PSScriptRoot}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    }
    # Short numeric slots keep the absolute argument within Windows' original
    # buffer. Each junction retains its package target across later updates.
    $alias=$null
    foreach($entry in @(Get-ChildItem -LiteralPath $root -Directory)){
        if($entry.Name -match '^\d{4}$' -and $entry.LinkType -eq 'Junction' -and @($entry.Target).Count -eq 1 -and @($entry.Target)[0] -eq $official){$alias=$entry.FullName;break}
    }
    if(!$alias){
        for($slot=1;$slot -le 9999;$slot++){
            $candidate=Join-Path $root $slot.ToString('D4')
            # A removed Store version can leave a dangling junction. Its entry
            # still occupies this slot even when Test-Path follows it to false.
            if(!(Get-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue)){$alias=$candidate;break}
        }
        if(!$alias){throw 'No unused argument alias slot is available'}
    }
    $argument=Join-Path $alias 'ChatGPT.exe'
    if($argument.Length+1+'--remote-debugging-port=0'.Length -gt $image.Length){throw 'Absolute image alias does not fit the original startup buffer'}
    if(Test-Path -LiteralPath $alias){
        $link=Get-Item -LiteralPath $alias
        if($link.LinkType -ne 'Junction' -or @($link.Target).Count -ne 1 -or @($link.Target)[0] -ne $official){throw 'Existing version alias has a different target; it was preserved'}
    }else{New-Item -ItemType Junction -Path $alias -Target $official|Out-Null}
    $argument
}
