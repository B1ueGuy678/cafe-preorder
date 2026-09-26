# 交接文档 · 新对话从这里开始

> 用途：换一个新对话继续推进本项目时，先读这份文件，再读它指向的文档。
> 这样无需在对话里复述任何上下文。
> 更新于：阶段 2 完成时（2026-09-26）；仓库改名后由新对话更正路径与提交数

---

## 1. 一句话现状

一个**能跑起来**的咖啡店到店预点单产品：顾客端下单、店员端接单、订单状态机、
模拟支付全部实现，68 项自动化测试通过（smoke 20 + e2e 36 + guards 12）。
阶段 0-2 已完成，阶段 3 进行中：**S3-1 服务端硬化、S3-2 顾客端韧性、S3-3 店员端韧性已完成**；
S3-4 里 `next build` 与密钥自查已过，只剩 375px 真机实测。阶段 3 规格见 `docs/POLISH.md`。

## 2. 项目基本信息

| 项 | 值 |
| --- | --- |
| 仓库路径 | `D:\DeepSeek\cafe-preorder` |
| 远程 | https://github.com/B1ueGuy678/cafe-preorder |
| 分支 | `main` |
| 技术栈 | Next.js 15 + TypeScript + Prisma + SQLite（开发）/ Postgres（生产） |
| 支付 | 模拟支付（`PAY_MODE=MOCK`） |
| 本地分支状态 | **领先远程 6 个提交，尚未 push** |

## 3. 这是什么题目

用户在做一道自己出的黑客松题：**《从 0 到 1：一个真实用户在用的东西》**，
要求用 vibe coding 走完一次产品开发的全流程：

```
阶段0 需求发现 → 阶段1 产品定义 → 阶段2 技术设计 → 阶段3 MVP 切片/打磨
   → 阶段4?? → 阶段6 上线部署 → 阶段7 用真实用户复盘
```

题目原文在另一段对话里（工作区对话《Vibecoding黑客松全流程题目》），
其核心纪律已固化进本仓库的实践：先规格后代码、小步提交、契约先冻结、
三次法则（同一 bug 改三次不成就回滚）、每轮新对话先读文档防风格漂移。

## 4. 已完成阶段与提交

| 提交 | 内容 | 对应产物 |
| --- | --- | --- |
| `5baf2f5` | 阶段 0：用户调研报告 | `PRD.md`（5 顾客 + 1 店员访谈、三类点单动线、反常识发现、痛点排序） |
| `92129c4` | 阶段 1：产品定义 | `docs/PRODUCT.md`（目标用户、价值主张、故事地图、15 条验收标准、非目标、线框） |
| `91ddb47` | 阶段 2：技术设计 + 可运行骨架 | `docs/ARCHITECTURE.md` + 全部源码 |

更早的 `1c9a72f`（仓库初始化）、`5672340`（网络环境说明）已在远程。

## 5. 最重要的产品决策（不要重新推翻，除非有新证据）

调研推翻了最初的直觉假设，产品因此被重新定位。**这是全项目最关键的一段上下文**。

| 原假设 | 调研结论 | 已定的方案 |
| --- | --- | --- |
| 核心用户是早高峰赶时间的上班族 | 他们接受度**最低**：步行仅 8 分钟，提前点单咖啡会凉，而现场排队只要 3-5 分钟 | 核心用户改为**双手被占用者**（推婴儿车 / 拎物 / 陪人） |
| 核心价值是省排队时间 | 步行 15 分钟圈内排队本就不长，省时间价值很薄 | 核心价值改为**减少操作与决策摩擦** |
| 预点单 = 提前做好 | 提前做好 = 意式咖啡必凉（温度与 crema 流失） | 改为**按到达时刻倒推下料** |
| 店员是阻力方 | 店员欢迎高峰预点单，怕的是单集中涌入与熟客人情味流失 | 店员是**共同用户**，产品必须给他「控速」能力 |
| 社区店人情味是次要顾虑 | 店员视为核心竞争力与生存问题 | 提升为**硬约束**（取餐凭据用报手机尾号/名字） |

**被明确放弃的方向**：面向早高峰通勤族的「出门前点好、到店即取」。

## 6. 核心技术机制（改代码前必读）

```
顾客选定到店时刻 8:30（5 分钟粒度）
        ↓
下料时刻 = 8:30 − shop.prepMinutes(3min) = 8:27
        ↓
顾客 8:30 到店，咖啡刚好做好
```

两个**唯一真相来源**，改动必须从这里改，不要在别处重算：

- `src/lib/time.ts` → `computeStartMakingAt(arrivalAt, prepMinutes)`
- `src/lib/domain.ts` → `expectedReadyAt(order)`：**做好时刻就等于 `arrivalAt`，
  不要用 `startMakingAt + T` 反推**。数学上相等，但多一次计算就多一处可能与
  `shop.prepMinutes` 不一致的地方——这是本项目最容易写出 bug 的位置。

**第二个关键约束**：店员端队列**按 `arrivalAt` 排序，不是按下单时刻**。
这是本产品区别于普通点单小程序的地方，改排序等于改产品。

**第三个关键约束**：所有状态流转必须经 `src/lib/domain.ts`，由
`src/lib/status.ts` 的 `assertTransition` 校验（AC-14：终态不可再次流转）。
页面与路由**不允许**直接改状态字段。

## 7. 代码结构

```
src/
├── app/
│   ├── page.tsx                    顾客端下单页
│   ├── order/[id]/page.tsx         订单状态页（4 秒轮询）
│   ├── staff/page.tsx              店员接单台（含口令门）
│   └── api/
│       ├── orders/route.ts         GET 选项 / POST 下单（含幂等键）
│       ├── orders/[id]/route.ts    GET 详情 / POST 取消·催单
│       ├── cron/auto-cancel/route.ts 定时兜底取消（需 CRON_SECRET，部署用）
│       └── staff/
│           ├── auth/route.ts       口令登录 / 登出（含失败限速）
│           ├── queue/route.ts      GET 队列 / POST 店铺设置
│           └── orders/[id]/route.ts POST 接单·拒单·做好·取餐
├── components/  OrderPicker / OrderStatusTracker / StaffConsole / StaffGate
└── lib/         status.ts★ time.ts★ domain.ts★ db.ts staff-auth.ts
                 http.ts（请求体守卫）error-text.ts（报错中文化）use-polling.ts（断网可见）
scripts/         smoke.mjs / e2e.mjs / guards.mjs / db-provider.mjs
根目录           start.cmd + start.ps1（一键启动，会自行 cd 到项目目录）
```

★ = 核心逻辑，改动需谨慎。

## 8. 怎么跑起来（本机有特殊约束，务必照抄）

> **省事版**：双击项目根目录的 `start.cmd`（等价于 `start.ps1`）——它会自动补依赖 /
> Prisma Client / 种子数据，处理端口冲突（本项目已在跑则复用，绝不启第二个），
> 等前后端都就绪再打开浏览器。下面的手动命令用于排障与理解每一步。

```bash
cd D:\DeepSeek\cafe-preorder

# 依赖（必须带 --cache，否则缓存写工作区外被拒）
npm install --cache .npm-cache

# Prisma 三连（已移除 postinstall，必须手动执行）
node ./node_modules/prisma/build/index.js generate
node ./node_modules/prisma/build/index.js db push --skip-generate
node prisma/seed.mjs

# 开发服务器
node ./node_modules/next/dist/bin/next dev -p 3000
```

- 顾客端 http://localhost:3000
- 店员端 http://localhost:3000/staff
- 数据库 `prisma/dev.db` 已被 gitignore，**新环境必须重新 `db push` + `db:seed`**

## 9. 环境雷区（本机特有，已踩过的坑）

| 现象 | 原因 | 应对 |
| --- | --- | --- |
| `spawn EPERM` | 沙箱禁止 spawn 子进程 | `next dev`、`prisma db push` 需要更宽权限或改到普通终端；**不要用 pnpm**（DSH 内置 runner 必失败） |
| `npm install` 整体回滚 | `postinstall` 触发 rebuild → spawn | **已从 package.json 移除 postinstall**，改为手动 `db:generate` |
| npm 缓存 EPERM | 默认缓存在工作区外 | 固定加 `--cache .npm-cache` |
| 直连 github.com 超时 | 网络层阻挡 | 仓库级已配 `http.proxy=http://127.0.0.1:23995` + `http.sslBackend=openssl` |
| 沙箱内所有 HTTPS 失败 | TLS 层拦截（连 baidu 都不通） | 只有 git 带 OpenSSL + 代理能出去；`Invoke-WebRequest` 不可用于外部 HTTPS |
| push 卡住 | 沙箱无凭据，凭据只存在于用户终端 | **push 必须由用户在自己终端执行** |
| 代理端口失效 | 星驰加速器重启会换端口 | 查 `SETUP.md`，用 `netstat` 找新端口 |

完整说明见 `SETUP.md`（含已验证可用的命令序列）。

## 10. 验证命令与当前结果

```bash
node scripts/smoke.mjs    # 核心机制与状态机，20 项，无需服务器 → 全通过
node scripts/e2e.mjs      # 真实 HTTP 主流程 + 异常路径，36 项，需 dev server → 全通过
node scripts/guards.mjs   # 口令限速与支付失败，12 项，自带独立 server → 全通过
node ./node_modules/next/dist/bin/next build       # → 生产构建通过（阶段 3 / R-13 补验）
node ./node_modules/typescript/bin/tsc --noEmit   # → exit 0
```

三个脚本都会清理自己产生的测试数据（`guards.mjs` 连自己起的 server 一起杀掉），可反复运行。
**跑 `guards.mjs` 前先停掉 dev server**：两个 `next dev` 共用 `.next` 会互相覆盖构建产物
（症状是页面开始 404/500），脚本会检查 3000 端口并拒绝并行运行。

**已验证的验收标准**：AC-2、AC-3、AC-4、AC-5、AC-6、AC-7、AC-8、AC-14（数据面）

**尚未验证，必须真人在浏览器里做**：

- AC-1「30 秒内完成下单」——需要真人计时
- AC-11「双端 30 秒内可见」——需要两个窗口并排观察
- AC-13「375px 无横向滚动」（= R-14）——需要真机或模拟器
- R-6 / R-7「断网横幅」「失败文案中文化」——需要 DevTools 切 Offline，
  步骤见 `docs/POLISH.md` §6
- AC-15「陌生人独立完成全流程」——需要真实用户
- R-10 / R-11「店员端陈旧横幅」「并发处理回执」——需要 DevTools Offline 与双标签页，
  步骤见 `docs/POLISH.md` §6

已在阶段 3 补验：生产构建 `next build` 通过（13 秒，退出码 0）。

## 11. 未完成事项

**立刻要做**：

1. 本地领先远程 1 个提交（阶段 3 的 S3-3），需用户在自己终端 `git push`

**阶段 3（进行中，规格与任务见 `docs/POLISH.md`）**：

2. ✅ 异常路径的服务端一侧（S3-1 / R-1…R-5）：并发流转、重复提交、畸形请求、
   支付失败、口令限速 —— 已实现并测试
3. ✅ 顾客端韧性（S3-2 / R-6…R-9）：断网横幅、失败文案中文化、空态、提交防重
4. ✅ 店员端韧性（S3-3 / R-10…R-12）：队列陈旧横幅、空队列文案、并发与失败回执
5. 🚧 上线前检查（S3-4）：`next build` ✅（R-13）、密钥自查 ✅（R-15）、375px 真机 ⬜（R-14）
6. ⬜ `/staff` 的口令门升级为真实认证（若要给多人用）

**阶段 6-7（上线与复盘）**：

7. 🚧 部署到 Vercel（Hobby）+ Neon Postgres：**操作清单已备好，见 `docs/DEPLOY.md`**。
   代码侧已就绪——`npm run build` 自带 `prisma generate`、`node scripts/db-provider.mjs postgres`
   一键切库、`/api/cron/auto-cancel` 提供定时兜底（需 `CRON_SECRET`，未配置时 503 禁用）。
   剩下的是要账号的动作：建 Neon 库、Vercel 导入仓库、配 4 个环境变量、初始化生产库
8. ✅ `DEMO.md` 骨架已建（阶段 7 的产物容器，待填真实地址与使用记录）
9. ⬜ 让真实用户（那家咖啡店）实际用一次，记录差评并当场修

**已知技术债**（有意识取舍，不是遗漏）：

- 无账号体系（取餐凭据是手机尾号后四位，为满足 AC-1 的 30 秒下单）
- 轮询而非推送（4 秒间隔，多顾客时请求量线性增长）
- 无历史订单页
- SQLite 不适合生产并发写
- 超时自动取消依赖请求触发（无后台任务，接 Vercel Cron 可解）

## 12. 给新对话的开场建议

直接说：

> 读 `D:\DeepSeek\cafe-preorder\docs\HANDOFF.md` 和 `docs/ARCHITECTURE.md`，然后继续阶段 3。

或者只给一个具体任务（例如「把订单状态页的断网与错误态补齐」），
让新对话自己读文档即可。**不要在新对话里重新讨论产品定位**——
那部分决策及其证据都写在 `docs/PRODUCT.md` 第 0 节。

## 13. 工作区规则提醒

- 工作区根目录 `D:\DeepSeek` 只放主题文件夹，本项目产出全部在 `cafe-preorder/` 内
- 本项目的每个阶段产物都落盘进仓库，不散落在对话里
- 密钥、口令、Token 一律不入库、不进对话（`grep` 自查已纳入流程）
