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

## 1. 建 Postgres（Neon 免费额度）

1. neon.tech 建项目，拿连接串，形如：
   `postgresql://user:pw@ep-xxx.aws.neon.tech/neondb?sslmode=require`
2. **连接串不要进仓库、不要贴进对话**，只填进 Vercel 的环境变量。

## 2. 切 provider 并推分支

```bash
cd D:\DeepSeek\cafe-preorder
node scripts/db-provider.mjs status      # 先看当前是 sqlite 还是 postgresql
node scripts/db-provider.mjs postgres    # sqlite → postgresql
git add prisma/schema.prisma
git commit -m "chore: 生产切 Postgres"
git push
```

> 本地还要继续开发就 `node scripts/db-provider.mjs sqlite` 切回来（脚本幂等，可反复跑）。
> 长期方案是本地也跑 Postgres 容器；本项目为了「零安装本地开发」保留 sqlite 主线，
> 这是有意识的取舍，不是遗漏。

## 3. Vercel 导入仓库

1. vercel.com → Add New → Project → 选 `cafe-preorder`
2. Framework 会识别成 Next.js；**Build Command 保持默认**（`npm run build`，
   已在 `package.json` 里带上 `prisma generate`，不需要你在面板里手写）
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
node ./node_modules/prisma/build/index.js db push
node prisma/seed.mjs
```

确认：访问线上 `/` 能看到「巷口咖啡」和 12 项菜单。种子脚本是幂等的，重复跑不会产生重复数据。

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
