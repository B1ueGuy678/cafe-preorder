# 上线部署（阶段 6）

> 目标：把这套东西放到公网，让那家咖啡店真的能用一次（见 `docs/HANDOFF.md` §11）。
> 本文件是可照抄的操作清单，每步都写了「做完怎么确认」。

---

## 0. 先认下两件事

1. **必须换 Postgres**。Vercel 的函数文件系统是临时的，SQLite 写进去就丢。
   本地开发继续用 SQLite（保住「零安装就能跑」这个性质），生产用 Neon / Supabase 免费 Postgres。
2. **必须配口令**。`STAFF_PASSCODE` 不配，生产环境的 `/staff` 会一律拒绝——
   这是设计（`src/lib/staff-auth.ts`），但也意味着不配就没人能接单。
   接单台会显示顾客手机尾号，这道门不能省。

---

## 1. 建 Postgres（两条路，推荐第一条）

**路 A（少三步，推荐）：用 Vercel 自带的 Postgres**

1. Vercel 项目建好后 → 顶部 **Storage** → **Create Database** → 选 Postgres（Neon 提供）
2. 创建时勾选连接到本项目 → 连接串由 Vercel 自动注入，不用手抄

**路 B：自己开 Neon**

1. neon.tech 建项目，拿连接串，形如：
   `postgresql://user:pw@ep-xxx.neon.tech/neondb?sslmode=require`
2. Vercel 项目 → Settings → Environment Variables → 手动加 `DATABASE_URL`

### 1.1 注入的变量名怎么认（这一步最容易卡住）

Vercel 的 Postgres 集成会给一组变量，名字不完全固定。**本项目代码里已经做了兜底**，
按下面的优先级自动挑；你只要确认「至少有一个存在」就行：

| 用途 | 变量优先级 | 为什么 |
| --- | --- | --- |
| 应用运行时查询 | `DATABASE_URL` → `POSTGRES_PRISMA_URL` → `POSTGRES_URL` | 用**池化**地址（主机名带 `-pooler`），无服务器并发下更稳 |
| 建表 / 初始化（DDL） | `DATABASE_URL_UNPOOLED` → `POSTGRES_URL_NON_POOLING` → `DATABASE_URL` → … | 必须用**直连**地址：池化器不支持建表语句，拿池化串跑 `db push` 会失败 |

代码位置：`src/lib/db-url.ts`（运行时兜底）、`scripts/db-init-prod.mjs`（挑直连串）。

**怎么确认注入成功**：Vercel 项目 → Settings → Environment Variables，
列表里应能看到 `DATABASE_URL`（或至少 `POSTGRES_URL` / `DATABASE_URL_UNPOOLED`）。
一个都没有 → 回 Storage 页面确认数据库确实连接到了这个项目，或手动加一条。

> 两条路的共同点：**连接串不要进仓库、不要贴进对话**。

## 2. 推送代码（不需要手工切 provider）

```bash
cd D:\DeepSeek\cafe-preorder
git status -sb     # 确认工作区干净、看看领先远程几个提交
git push
```

**为什么不用手工切库**：Prisma 的 provider 读不了环境变量，而本地开发必须用 SQLite
（本机对外 HTTPS 受限，云数据库在本地连不上，见 `SETUP.md`）。所以：

- 仓库里的 `prisma/schema.prisma` **永远是 `sqlite`**
- `vercel.json` 的 `buildCommand` 在 **Vercel 自己的临时检出里**先切成 `postgresql`，
  再生成 Client、再构建

这样本地开发、仓库内容、线上构建三者不会互相打架，也不会因为「本地切回 sqlite 顺手提交」
把线上构建弄坏（这条坑是设计时特意避开的）。

> 手动切库的能力仍然保留：`node scripts/db-provider.mjs status|sqlite|postgres`。

## 3. Vercel 导入仓库

1. vercel.com → Add New → Project → 选 `cafe-preorder`
2. Framework 会识别成 Next.js。**Build Command 保持默认、不要开 Override**——
   仓库里的 `vercel.json` 会覆盖它，自动做「切 provider → 生成 Client → 构建」三步
3. 环境变量：

| 变量 | 值 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | Neon 连接串 | 必须带 `?sslmode=require` |
| `STAFF_PASSCODE` | 你自己定，**别用 4 位数字** | 店员入口口令；连续错 5 次锁 5 分钟 |
| `PAY_MODE` | `MOCK` | 阶段 6 仍是模拟支付，未接真实支付 |
| `CRON_SECRET` | 随机长串 | 给 `/api/cron/auto-cancel` 用；不配则该端点 503 |

4. Deploy

## 4. 初始化生产库（只需一次）

在本地对着**生产** `DATABASE_URL` 跑（PowerShell）：

```powershell
$env:DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require"
node scripts/db-init-prod.mjs
Remove-Item Env:DATABASE_URL      # 用完清掉，避免影响后续本地开发
```

脚本会先在 `DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING / DATABASE_URL / …`
里自动挑一条**直连**串，并打印「使用变量：XXX」——所以你也可以把 Vercel 那一整组变量
都贴进本地环境，让它自己选。挑到池化地址（`-pooler`）时它会告警并建议换直连串。

这个脚本替你做四件事，并且**无论成败都把本地环境还原回 SQLite**：

1. 校验 `DATABASE_URL` 确实是 Postgres 连接串（防止手滑拿本地库去初始化线上）
2. 临时切 provider → 生成 Postgres 版 Client
3. `prisma db push` 建表 + 跑种子数据（幂等，重复跑不会重复插入）
4. 还原 provider 与 Client 到 SQLite（失败也会还原，不会把本地开发搞坏）

确认：访问线上 `/` 能看到「巷口咖啡」和 12 项菜单；终端里种子脚本会打印当前菜单项数。

## 5. 上线后自检（照着点一遍）

| 检查 | 期望 |
| --- | --- |
| `GET /` | 200，能看到菜单与到店时间 |
| `GET /staff` | 200，要求输入口令；**未登录时 HTML 里不应出现任何手机尾号** |
| 下单一次 | 跳 `/order/:id`，显示「预计做好 = 到店时刻」 |
| 店员接单 | 队列按**到店时刻**排序，不是按下单时刻 |
| 双端可见 | 店员接单后顾客页 30 秒内变化（AC-11） |
| 断网 | DevTools → Offline，出现「网络不稳」横幅（R-6） |
| `GET /api/cron/auto-cancel` 不带 Authorization | 401 |
| 仓库自查 | 没有口令 / Token / 密钥（见 `HANDOFF` §13） |

## 6. 定时兜底（可选）

`vercel.json` 已配 `0 12 * * *`（UTC，= 北京时间 20:00，打烊后清一次）。

**注意：Vercel Hobby 的 Cron 每天只能跑一次**，所以 AC-8 的超时取消主力仍然是
「有请求就顺手清理」（顾客端轮询、店员台刷新都会触发，见 `docs/ARCHITECTURE.md` §5）。
想要分钟级兜底，二选一：

- 升 Vercel Pro，把 schedule 改成 `*/5 * * * *`；
- 或者用 cron-job.org 每 5 分钟 GET 一次
  `https://<你的域名>/api/cron/auto-cancel`，带 `Authorization: Bearer <CRON_SECRET>`。

## 7. 回滚

- Vercel → Deployments → 选上一个成功版本 → Promote to Production
- 数据库变更（`db push`）没有自动回滚；本项目至今只有加列类变更，向后兼容

## 8. 已知局限（上线前先认下来）

- 口令限速计数在进程内存里 → 多实例部署会各算各的（单店单实例够用）
- 轮询而非推送：4 秒一次，多顾客时请求量线性增长
- 无账号体系：取餐凭据是手机尾号后四位（为满足 AC-1 的 30 秒下单）
- 无历史订单页
- 模拟支付：`PAY_MODE=MOCK`，不产生真实扣款
