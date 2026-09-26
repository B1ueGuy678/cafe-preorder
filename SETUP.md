# 拉取与推送（本机网络环境说明）

本仓库所在机器的网络环境有两层障碍，换机器或重装后按本文件恢复即可。

## 现象

- **直连 github.com 超时**：`Failed to connect to github.com port 443 after 21000 ms`
- **schannel 报错**：`schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030e)`

第二条不是网络问题，是 Git for Windows 默认 TLS 后端（schannel）在当前环境下拿不到
凭据句柄。**换 OpenSSL 后端即可绕过**。

## 可用组合

```bash
git -c http.sslBackend=openssl -c http.proxy=http://127.0.0.1:23995 pull
git -c http.sslBackend=openssl -c http.proxy=http://127.0.0.1:23995 push
```

其中 `127.0.0.1:23995` 是本机代理端口（由 `D:\星驰加速器\core.exe` 提供）。
**端口随代理软件启动变化，失效时先确认新端口。**

## 固化进本仓库（推荐）

只想影响本仓库、不动全局配置：

```bash
git config --local http.sslBackend openssl
git config --local http.proxy http://127.0.0.1:23995
```

设置后直接 `git pull` / `git push` 即可，无需每次带 `-c` 参数。

## 本机 Git 环境事实

| 项 | 值 |
| --- | --- |
| Git 可执行文件 | `C:\Users\27034\AppData\Local\hermes\git\cmd\git.exe`（Hermes 便携版） |
| Git 版本 | 2.54.0.windows.1，libcurl 8.19.0，OpenSSL 3.5.6 |
| 系统 Git | 无（`C:\Program Files\Git` 不存在） |
| `gh` CLI | 未安装 |
| SSH 私钥 | 无（仅 `known_hosts`） |
| 凭据助手 | system 级 `helper-selector` → `git-credential-manager.exe` |
| 代理进程 | `D:\星驰加速器\core.exe`，监听 `127.0.0.1:23995` |

## 已知限制

- 便携版 Git 的 `sh.exe` 在受限沙箱下可能报
  `couldn't create signal pipe, Win32 error 5`，属环境限制，非仓库问题。
- 若凭据助手的浏览器授权窗口无法在沙箱内弹出，
  在自己的终端里执行一次 push 完成授权，凭据会被记住，之后在沙箱内即可正常推送。

---

# 工程环境约束（Node / npm / Prisma）

这套环境有若干处会静默破坏构建的限制，全部记录下来。

## 1. 沙箱禁止 spawn 子进程

表现为 `Error: spawn EPERM`（errno -4048）。已知会触发的操作：

| 操作 | 结果 |
| --- | --- |
| DSH 内置的 `pnpm` runner | 直接失败，**不要用 pnpm，改用 npm** |
| `npm install` 的 `postinstall` | 触发 rebuild → spawn → **整个安装被回滚** |
| `prisma db push` / `migrate` | schema engine 二进制无法启动 |
| `next dev` / `next build` | 无法启动编译工作进程 |

**应对**：

- `package.json` 中**已移除 `postinstall`**，改为手动 `npm run db:generate`。
  否则 `npm install` 会在最后一步把装好的 `node_modules` 全部回滚。
- Prisma CLI 用 `node ./node_modules/prisma/build/index.js <cmd>` 直接调用，
  绕开外壳包装。
- `prisma db push` 与 `next dev` 需要更宽的执行权限，
  或改到普通终端里执行（推荐，不受影响）。

## 2. npm 缓存必须放在工作区内

默认缓存目录 `C:\Users\<用户>\AppData\Local\npm-cache` 在工作区之外，会被拒绝：

```
npm error EPERM: operation not permitted, open '...\npm-cache\_cacache\tmp\...'
```

**应对**：固定带上缓存参数。

```bash
npm install --cache .npm-cache
```

`.npm-cache/` 已加入 `.gitignore`。

## 3. 已确认可用的命令序列

```bash
# 安装（必须带 --cache；当前 package.json 已无 postinstall，无需 --ignore-scripts）
npm install --cache .npm-cache

# Prisma：校验 / 生成 / 建库
node ./node_modules/prisma/build/index.js validate
node ./node_modules/prisma/build/index.js generate
node ./node_modules/prisma/build/index.js db push --skip-generate

# 种子数据与测试
node prisma/seed.mjs
node scripts/smoke.mjs
node scripts/e2e.mjs          # 需 dev server 运行中

# 类型检查
node ./node_modules/typescript/bin/tsc --noEmit

# 开发服务器（沙箱内需更宽权限，或改到普通终端）
node ./node_modules/next/dist/bin/next dev -p 3000
```

## 4. 数据库选型说明

本机**没有 Docker、没有本地 Postgres**，因此：

- 开发库用 **SQLite**（零安装，`prisma/dev.db`，已 gitignore）
- 生产切 Postgres 只需改 `datasource` 与 `DATABASE_URL` 并重新迁移，
  业务代码无需改动（Prisma 屏蔽了差异）

