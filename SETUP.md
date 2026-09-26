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
