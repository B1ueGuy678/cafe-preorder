<#
=============================================================================
  咖啡店预点单 · 一键启动脚本（Windows PowerShell 5.1 及以上）
=============================================================================

【怎么用】
  方式一（推荐）：双击项目根目录的 start.cmd
  方式二：在任意 PowerShell 窗口执行
        powershell -ExecutionPolicy Bypass -File D:\DeepSeek\cafe-preorder\start.ps1

  脚本会自己 cd 到项目根目录（本文件所在目录），在哪个目录调用都行。

【可选参数】
  -Port 3000        想用的端口（默认 3000）；被别的程序占用时自动往后找空端口
  -NoBrowser        不自动打开浏览器（远程 / 服务器上跑时用）
  -Prod             生产模式：先构建再 next start（慢约 15 秒，更接近线上）
  -Reset            重建本地数据库结构并重写种子数据，排障用
  -TimeoutSec 120   等待服务就绪的最长秒数

【它做了什么】
  1/6 找到 Node（优先 node.exe，找不到再兜底常见安装目录）
  2/6 缺依赖则 npm install --cache .npm-cache（本机缓存必须落在工作区内，见 SETUP.md）
  3/6 缺 Prisma Client 则生成（本项目移除了 postinstall，必须手动，见 SETUP.md）
  4/6 缺数据库 prisma/dev.db 则自动 db push + seed（幂等，可反复跑）
  5/6 端口冲突处理：
        · 本项目已经在跑 -> 直接复用并打开浏览器，**绝不启第二个**
          （两个 next dev 共用 .next 会互相覆盖构建产物，症状是页面 404/500）
        · 端口被别的程序占用 -> 自动往后找第一个空端口
  6/6 启动服务并等待**后端与前端都就绪**（GET /api/orders 与 GET / 都返回 200），
      然后打开默认浏览器

【为什么「前端 + 后端」是同一个进程】
  本项目是 Next.js 全栈：页面（App Router）与接口（Route Handlers）由同一个
  Next 进程提供，没有可以单独拉起来的第二个后端进程。脚本用「/api/orders 就绪」
  代表后端、用「/ 就绪」代表前端，两个都 200 才算启动完成。

【怎么停】
  用脚本最后打印的 PID：Stop-Process -Id <PID>
  或者直接关掉那个新开的 node 服务窗口

【常见排障】
  · 端口老是变：说明 3000 被别的程序占了，用 -Port 指定，或关掉占用者
  · 卡在「等待就绪」：手动跑 node ./node_modules/next/dist/bin/next dev -p 3000 看报错；
    多半是数据库没初始化（加 -Reset）或环境限制（见 SETUP.md）
  · 中文乱码：本文件必须保存为「UTF-8 带 BOM」，否则 PowerShell 5.1 会按 ANSI 读
=============================================================================
#>

[CmdletBinding()]
param(
  [int]$Port = 3000,
  [switch]$NoBrowser,
  [switch]$Prod,
  [switch]$Reset,
  [int]$TimeoutSec = 120
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Text) { Write-Host ""; Write-Host "▶ $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text)   { Write-Host "  √ $Text" -ForegroundColor Green }
function Write-Hint([string]$Text) { Write-Host "  ! $Text" -ForegroundColor Yellow }
function Write-Bad([string]$Text)  { Write-Host "  × $Text" -ForegroundColor Red }

# ---------- 0. 自动进入项目目录 ----------
$Root = $PSScriptRoot
if ([string]::IsNullOrEmpty($Root)) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Definition }
Set-Location -LiteralPath $Root

Write-Host "==============================================================" -ForegroundColor DarkCyan
Write-Host "  咖啡店预点单 · 一键启动" -ForegroundColor White
Write-Host "  项目目录：$Root" -ForegroundColor DarkGray
Write-Host "==============================================================" -ForegroundColor DarkCyan

if (-not (Test-Path (Join-Path $Root 'package.json'))) {
  Write-Bad "这里不是项目根目录（找不到 package.json）：$Root"
  exit 1
}

# ---------- 工具函数 ----------
function Test-PortListening([int]$P) {
  try {
    $c = Get-NetTCPConnection -State Listen -LocalPort $P -ErrorAction Stop
    return ($null -ne $c)
  } catch { return $false }
}

function Get-PortOwner([int]$P) {
  try {
    $c = Get-NetTCPConnection -State Listen -LocalPort $P -ErrorAction Stop | Select-Object -First 1
    $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    if ($proc) { return "$($proc.ProcessName) (PID $($proc.Id))" }
    return "PID $($c.OwningProcess)"
  } catch { return "未知进程" }
}

# 判断某个端口上跑的是不是本项目：只看纯 ASCII 的接口特征，避免编码坑
function Test-OurApp([int]$P) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$P/api/orders" -UseBasicParsing -TimeoutSec 5
    return ($r.StatusCode -eq 200 -and $r.Content -match '"slots"')
  } catch { return $false }
}

function Find-FreePort([int]$Start, [int]$Span = 20) {
  for ($p = $Start; $p -lt ($Start + $Span); $p++) {
    if (-not (Test-PortListening $p)) { return $p }
  }
  return 0
}

# 用 Start-Process 调外部程序：输出直接进当前窗口（用户在正常终端里能看到实时日志），
# 同时能拿到退出码；比 & 调用更稳（某些受限环境下 & 的子进程管道会被拦）
function Invoke-External {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$What = ""
  )
  try {
    $p = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $Root -Wait -PassThru -NoNewWindow
    return $p.ExitCode
  } catch {
    Write-Bad ("{0} 启动失败：{1}" -f $What, $_.Exception.Message)
    return 1
  }
}

function Invoke-NodeScript {
  param([string]$ScriptPath, [string[]]$Arguments = @(), [string]$What = "")
  return Invoke-External -FilePath $script:NodeExe -Arguments (@($ScriptPath) + $Arguments) -What $What
}

# 读 Node 版本号：输出重定向到临时文件再读，兼容各种终端
function Get-NodeVersion([string]$Exe) {
  $tmp = Join-Path $env:TEMP ("node-version-" + [guid]::NewGuid().ToString("N") + ".txt")
  try {
    Start-Process -FilePath $Exe -ArgumentList '-p', 'process.version' -Wait -PassThru -NoNewWindow -RedirectStandardOutput $tmp -ErrorAction Stop | Out-Null
    if (Test-Path $tmp) { return (Get-Content -LiteralPath $tmp -Raw).Trim() }
  } catch { }
  finally { if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue } }
  return ""
}

# ---------- 1/6 Node ----------
Write-Step "1/6 检查 Node 环境"
$NodeExe = $null
foreach ($name in @('node.exe', 'node')) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { $NodeExe = $cmd.Source; break }
}
if (-not $NodeExe) {
  foreach ($guess in @(
      (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
      (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'))) {
    if ($guess -and (Test-Path $guess)) { $NodeExe = $guess; break }
  }
}
if (-not $NodeExe) {
  Write-Bad "找不到 node，请安装 Node.js 18 或更高版本并确保它在 PATH 里"
  exit 1
}
$nodeVersion = Get-NodeVersion $NodeExe
if ([string]::IsNullOrEmpty($nodeVersion)) { $nodeVersion = '(读不到版本号)' }
Write-Ok "node $nodeVersion"
Write-Host "    路径：$NodeExe" -ForegroundColor DarkGray

# ---------- 2/6 依赖 ----------
Write-Step "2/6 检查依赖"
if (-not (Test-Path (Join-Path $Root 'node_modules\next'))) {
  Write-Hint "缺少依赖，执行 npm install --cache .npm-cache（缓存必须写在工作区内）"
  $npmCmd = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
  if (-not $npmCmd) { $npmCmd = Get-Command 'npm' -ErrorAction SilentlyContinue }
  if (-not $npmCmd) {
    Write-Bad "找不到 npm；请在项目目录手动执行：npm install --cache .npm-cache"
    exit 1
  }
  $code = Invoke-External -FilePath $npmCmd.Source -Arguments @('install', '--cache', '.npm-cache') -What 'npm install'
  if ($code -ne 0) { Write-Bad "npm install 失败（退出码 $code）"; exit 1 }
} else {
  Write-Ok "依赖已就绪"
}

# ---------- 3/6 Prisma Client ----------
Write-Step "3/6 检查 Prisma Client"
$prismaCli = './node_modules/prisma/build/index.js'
if (-not (Test-Path (Join-Path $Root 'node_modules\.prisma\client'))) {
  Write-Hint "缺少 Prisma Client，正在生成（本项目移除了 postinstall，必须手动跑）"
  if ((Invoke-NodeScript -ScriptPath $prismaCli -Arguments @('generate') -What 'prisma generate') -ne 0) {
    Write-Bad "prisma generate 失败"
    exit 1
  }
} else {
  Write-Ok "Prisma Client 已就绪"
}

# provider 检查：部署时可能切成了 postgresql，本地开发要 sqlite
$schemaFile = Join-Path $Root 'prisma\schema.prisma'
$schemaText = Get-Content -LiteralPath $schemaFile -Raw
if ($schemaText -match 'provider\s*=\s*"postgresql"') {
  if ($Prod) {
    Write-Ok "数据库 provider = postgresql（生产模式，按预期）"
  } else {
    Write-Hint "数据库 provider 现在是 postgresql，本地开发需要 sqlite，正在切回…"
    $switchCode = Invoke-NodeScript -ScriptPath './scripts/db-provider.mjs' -Arguments @('sqlite') -What 'db-provider'
    if ($switchCode -ne 0) { Write-Bad "切换 provider 失败"; exit 1 }
    if ((Invoke-NodeScript -ScriptPath $prismaCli -Arguments @('generate') -What 'prisma generate') -ne 0) {
      Write-Bad "切换 provider 后生成 Client 失败"
      exit 1
    }
  }
} else {
  Write-Ok "数据库 provider = sqlite（本地开发）"
}

# ---------- 4/6 本地数据库 ----------
Write-Step "4/6 检查本地数据库"
$dbFile = Join-Path $Root 'prisma\dev.db'
if ($Reset) { Write-Hint "指定了 -Reset，强制重建表结构并重写种子数据" }
if ($Reset -or -not (Test-Path $dbFile)) {
  Write-Hint "正在建库（prisma db push）并写入种子数据（一家店 + 12 项菜单）"
  if ((Invoke-NodeScript -ScriptPath $prismaCli -Arguments @('db', 'push', '--skip-generate') -What 'prisma db push') -ne 0) {
    Write-Bad "prisma db push 失败"
    exit 1
  }
  if ((Invoke-NodeScript -ScriptPath './prisma/seed.mjs' -What 'db:seed') -ne 0) {
    Write-Bad "种子数据写入失败"
    exit 1
  }
} else {
  Write-Ok "本地数据库已存在（prisma\dev.db）"
}

# ---------- 5/6 端口 ----------
Write-Step "5/6 端口检查与冲突处理"

# (a) 本项目已经在跑 -> 复用，绝不启动第二个
$alreadyOn = 0
for ($p = 3000; $p -le 3010; $p++) {
  if ((Test-PortListening $p) -and (Test-OurApp $p)) { $alreadyOn = $p; break }
}
if ($alreadyOn -gt 0) {
  Write-Ok "本项目已经在 http://localhost:$alreadyOn 运行，直接复用（不重复启动）"
  Write-Hint "两个 next dev 共用 .next 会互相破坏构建产物，所以这里只复用"
  if ($NoBrowser) {
    Write-Ok "按 -NoBrowser 要求，未打开浏览器"
  } else {
    Start-Process "http://localhost:$alreadyOn"
    Write-Ok "已用默认浏览器打开 http://localhost:$alreadyOn"
  }
  exit 0
}

# (b) 端口被别的程序占用 -> 自动换端口
if (Test-PortListening $Port) {
  $ownerText = Get-PortOwner $Port
  Write-Hint ("端口 {0} 已被占用（{1}）" -f $Port, $ownerText)
  $free = Find-FreePort ($Port + 1)
  if ($free -eq 0) {
    Write-Bad "从 $Port 往后 20 个端口都被占用了，请先释放或显式指定 -Port"
    exit 1
  }
  Write-Hint "自动改用空端口：$free"
  $Port = $free
} else {
  Write-Ok "端口 $Port 空闲"
}

# ---------- 6/6 启动并等待就绪 ----------
Write-Step "6/6 启动服务（前端页面 + 后端 API 同一进程）"
if ($Prod) {
  Write-Hint "生产模式：先构建（约 15 秒）"
  if ((Invoke-NodeScript -ScriptPath $prismaCli -Arguments @('generate') -What 'prisma generate') -ne 0) {
    Write-Bad "prisma generate 失败"
    exit 1
  }
  if ((Invoke-NodeScript -ScriptPath './node_modules/next/dist/bin/next' -Arguments @('build') -What 'next build') -ne 0) {
    Write-Bad "next build 失败"
    exit 1
  }
  $nextArgs = @('./node_modules/next/dist/bin/next', 'start', '-p', "$Port")
  $modeText = '生产模式（next start）'
} else {
  $nextArgs = @('./node_modules/next/dist/bin/next', 'dev', '-p', "$Port")
  $modeText = '开发模式（next dev，改代码即时生效）'
}

$server = Start-Process -FilePath $NodeExe -ArgumentList $nextArgs -WorkingDirectory $Root -PassThru
Write-Ok "服务进程已启动：PID $($server.Id)（$modeText）"

Write-Hint "等待就绪（最长 $TimeoutSec 秒；首次启动要等页面编译）…"
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$apiReady = $false
$pageReady = $false
while ((Get-Date) -lt $deadline) {
  if (-not $apiReady) {
    try {
      $apiRes = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/orders" -UseBasicParsing -TimeoutSec 5
      if ($apiRes.StatusCode -eq 200) { $apiReady = $true; Write-Ok "后端就绪：GET /api/orders 返回 200" }
    } catch { }
  }
  if (-not $pageReady) {
    try {
      $pageRes = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 10
      if ($pageRes.StatusCode -eq 200) { $pageReady = $true; Write-Ok "前端就绪：GET / 返回 200" }
    } catch { }
  }
  if ($apiReady -and $pageReady) { break }
  Start-Sleep -Milliseconds 800
}

if (-not ($apiReady -and $pageReady)) {
  Write-Bad "等待超时，服务没有就绪；已停掉刚启动的进程（PID $($server.Id)）"
  try { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue } catch { }
  Write-Hint "手动排查：node ./node_modules/next/dist/bin/next dev -p $Port"
  Write-Hint "常见原因见 SETUP.md（进程受限 / 数据库未初始化 / 端口被拦）"
  exit 1
}

if ($NoBrowser) {
  Write-Ok "按 -NoBrowser 要求，未打开浏览器"
} else {
  Start-Process "http://localhost:$Port"
  Write-Ok "已用默认浏览器打开 http://localhost:$Port"
}

Write-Host ""
Write-Host "==============================================================" -ForegroundColor DarkCyan
Write-Host "  启动完成" -ForegroundColor Green
Write-Host "    顾客端：http://localhost:$Port" -ForegroundColor White
Write-Host "    店员端：http://localhost:$Port/staff" -ForegroundColor White
Write-Host "    服务进程：PID $($server.Id)（日志在那个新开的 node 窗口里）" -ForegroundColor DarkGray
Write-Host "    停止服务：Stop-Process -Id $($server.Id)" -ForegroundColor DarkGray
Write-Host "    再次启动：重跑本脚本即可（会自动识别已在运行并复用）" -ForegroundColor DarkGray
Write-Host "==============================================================" -ForegroundColor DarkCyan
exit 0
