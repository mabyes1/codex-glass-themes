function New-CodexWatcherTriggers {
    param([Parameter(Mandatory)][string]$UserSid)
    # IgnoreNew plus the watcher mutex prevents a second worker. The periodic
    # trigger also recovers normal/externally interrupted exits that do not
    # qualify for Task Scheduler's limited restart-on-failure budget.
    New-ScheduledTaskTrigger -AtLogOn -User $UserSid
    New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
}
