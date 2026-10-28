# DJI Mic 3 RX — passive USB telemetry. No vendor commands and no audio driver changes.
# Emits only compact JSON; never exposes serial numbers or unverified percentages.
$ErrorActionPreference = 'Stop'
function Return-State($state) {
  $state | ConvertTo-Json -Compress -Depth 8
}
try {
  $devices = @(Get-PnpDevice -PresentOnly | Where-Object {
    $_.InstanceId -like 'USB\VID_2CA3&PID_4015&MI_04\*' -and $_.Status -eq 'OK'
  })
  if ($devices.Count -ne 1) {
    Return-State @{status='unavailable';reason='receiver-unavailable';tx=@();rx=@{level='unknown';percent=$null}}
    exit 0
  }
  $mic = $devices[0]
  $service = (Get-PnpDeviceProperty -InstanceId $mic.InstanceId -KeyName DEVPKEY_Device_Service -ErrorAction Stop).Data
  if ($service -ne 'WINUSB') {
    Return-State @{status='unavailable';reason='winusb-not-configured';tx=@();rx=@{level='unknown';percent=$null}}
    exit 0
  }
  $parameters = 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Enum\' + $mic.InstanceId + '\Device Parameters'
  $guids = @((Get-ItemProperty -LiteralPath $parameters -Name DeviceInterfaceGUIDs -ErrorAction Stop).DeviceInterfaceGUIDs)
  $guid = @($guids | Where-Object { $_ -match '^\{[0-9a-fA-F-]{36}\}$' })
  if ($guid.Count -ne 1) {
    Return-State @{status='unavailable';reason='winusb-device-interface-unavailable';tx=@();rx=@{level='unknown';percent=$null}}
    exit 0
  }
  $path = '\\?\' + $mic.InstanceId.Replace('\','#') + '#' + $guid[0]
  $native = Join-Path $PSScriptRoot 'DjiMic3PassiveBulkRead.cs'
  if (!(Test-Path -LiteralPath $native)) {throw 'Native passive reader not packaged.'}
  Add-Type -Path $native -ErrorAction Stop
  $answer = [DjiMic3PassiveBulkRead]::Probe($path)
  if ($answer -notmatch 'RESTORE_ALT0=True') {
    Return-State @{status='unavailable';reason='usb-read-incomplete';tx=@();rx=@{level='unknown';percent=$null}}
    exit 0
  }
  $bytes = New-Object 'System.Collections.Generic.List[byte]'
  foreach ($piece in [regex]::Matches($answer,'(?m)^DATA_\d+_HEX=([0-9A-F\-]+)')) {
    foreach ($one in $piece.Groups[1].Value.Split('-')) {$bytes.Add([Convert]::ToByte($one,16))}
  }
  function Frame-CrcValid([byte[]]$frame) {
    [int]$crc = 0x3692
    foreach ($one in $frame) {
      $crc = $crc -bxor [int]$one
      for ($k=0;$k -lt 8;$k++) {
        if (($crc -band 1) -ne 0) {$crc = (($crc -shr 1) -bxor 0x8408) -band 0xFFFF}
        else {$crc = ($crc -shr 1) -band 0xFFFF}
      }
    }
    return $crc -eq 0
  }
  $latest = $null
  $validFrames = 0
  for ($i=0;$i -lt ($bytes.Count - 12);) {
    if ($bytes[$i] -ne 0x55) {$i++;continue}
    $size = [int]$bytes[$i+1]
    if ($size -lt 14 -or $size -gt 220 -or ($i+$size) -gt $bytes.Count) {$i++;continue}
    if ($bytes[$i+2] -ne 4 -or $bytes[$i+4] -ne 0x5A) {$i++;continue}
    [byte[]]$frame = $bytes.GetRange($i,$size).ToArray()
    $i += $size
    if (!(Frame-CrcValid $frame)) {continue}
    $validFrames++
    if ($frame[5] -ne 2 -or $frame[8] -ne 0 -or $frame[9] -ne 0x5B -or $frame[10] -ne 3 -or $frame[11] -ne 3) {continue}
    if ($size -notin @(54,86,118) -or $frame[12] -ne (0x26 + ($size - 54))) {continue}
    $count = ($size - 54)/32
    [int]$mask = [int]$frame[44]
    $rows = @()
    for ($slot=1;$slot -le 2;$slot++) {
      $rows += @{slot=$slot;connected=(($mask -band (1 -shl ($slot-1))) -ne 0);rawGauge=$null;level='unknown';charging=$null;percent=$null;calibration='none'}
    }
    for ($n=0;$n -lt $count;$n++) {
      $start = 52 + (32*$n)
      if ($frame[$start] -ne 2 -or $frame[$start+1] -notin @(1,2) -or $frame[$start+5] -ne 26) {continue}
      $slot = [int]$frame[$start+1]
      $rawValue = [int]$frame[$start+7]
      $gauge = ($rawValue -shr 2) -band 7
      if ($gauge -lt 1 -or $gauge -gt 7) {continue}
      $rows[$slot-1].rawGauge = $gauge
      $rows[$slot-1].charging = (($rawValue -band 2) -ne 0)
      # Gauge 1 confirmed as 'full' on the user's own DJI Mic 3 RX, TX2.
      # Other levels remain uncalibrated; never manufacture a percent.
      $rows[$slot-1].level = if ($gauge -eq 1) {'full'}else{'uncalibrated'}
      $rows[$slot-1].calibration = if ($gauge -eq 1) {'rx-display-confirmed-tx2'}else{'raw-only'}
    }
    # Receiver's first record has 32 bytes; its u16 at r+6 contains an
    # uncalibrated RX battery code in bits 13..15. This layout is documented
    # for the DJI Mobile RX, and present in the Mic 3 frames captured here.
    # No percentage or capacity should be inferred from this code.
    $rxGauge = $null
    if ($frame[14] -eq 3 -and $frame[15] -eq 0 -and
        $frame[16] -eq 0 -and $frame[17] -eq 0 -and
        $frame[18] -eq 0 -and $frame[19] -eq 32) {
      $receiverFlags = [int]$frame[20] -bor ([int]$frame[21] -shl 8)
      $rxGauge = ($receiverFlags -shr 13) -band 7
      if ($rxGauge -lt 1 -or $rxGauge -gt 7) {$rxGauge = $null}
    }
    $latest = @{mask=$mask;tx=$rows;rxGauge=$rxGauge}
  }
  if (!$latest) {
    Return-State @{status='unavailable';reason='no-valid-status-frame';validFrames=$validFrames;tx=@();rx=@{level='unknown';percent=$null}}
    exit 0
  }
  $audio = @(Get-PnpDevice -PresentOnly | Where-Object { $_.FriendlyName -eq 'Wireless Mic Rx' -and $_.Status -eq 'OK' })
  Return-State @{
    status = 'ok'
    source = 'dji-mic3-rx-winusb'
    observedAt = [DateTime]::UtcNow.ToString('o')
    validFrames = $validFrames
    tx = $latest.tx
    rx = @{
      level = if ($null -ne $latest.rxGauge) {'uncalibrated'} else {'unknown'}
      rawGauge = $latest.rxGauge
      calibration = if ($null -ne $latest.rxGauge) {'raw-only'} else {'none'}
      percent = $null
    }
    audioHealthy = ($audio.Count -ge 1)
  }
} catch {
  # Never leak device paths, identifiers or stack traces through a public diagnostic endpoint.
  Return-State @{status='unavailable';reason='read-error';tx=@();rx=@{level='unknown';percent=$null}}
}
