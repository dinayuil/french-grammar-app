# 法语语法练习（应用）

React 18 + TypeScript + Vite + Capacitor 的客户端应用。应用代码与题库分离；公开题库是独立仓库。单元测试夹具使用原创合成数据，公开题库集成测试读取`content-public`。

- 应用远程：<https://github.com/dinayuil/french-grammar-app>
- 公开题库远程：<https://github.com/dinayuil/french-grammar-content-public>
- 公开网页版：<https://blog.yosorano.cc/french-grammar-app/>

本 README 只说明公开版。

## 内容说明

本应用内容由 AI 参与编写与复核，未经过人工法语审校。

## 目录

- `src/`：界面、判题、进度、音效与通用校验代码。
- `android/`：Capacitor Android 原生工程模板；生成内容不提交。
- `dist/public/`：公开版构建输出（不提交）。

## 开始

需要 Node.js 22 或更新版本、npm；Android 构建另需 JDK 21 与 Android SDK。依赖按 `package-lock.json` 安装：

```powershell
npm ci
```

## GitHub Pages

公开网页版由`.github/workflows/deploy-pages.yml`在`main`推送、`repository_dispatch` 或`main`上手动触发时部署。工作流检出`content-public`的 `main` 或 `repository_dispatch` 携带的提交，运行完整公开测试和`check:public`后构建`dist/public`；构建基路径由`actions/configure-pages`的`base_path`决定。上传前会本地校验构建产物：`index.html` 非空且含 `id="root"`，引用的 JS 资源存在、非空并与基路径匹配。部署后的外部冒烟检查为尽力而为：自定义域名的边缘可能以 403/429 拦截 GitHub Actions，此时只告警并跳过；404/500 或空资源仍会导致检查失败。

账号用户站启用自定义域名时，`https://dinayuil.github.io/french-grammar-app/`会跳转到上面的自定义域名。公开题库更新时，`content-public` 的 `main` 推送会通过 `repository_dispatch` 触发本工作流；无需再修改本仓库的 `CONTENT_PUBLIC_REF`。手动重试或回滚时，用 `workflow_dispatch` 的 `content_ref` 输入指定 SHA、分支或标签。CI 如需固定内容版本，设置仓库变量 `CONTENT_PUBLIC_REF`；未设置时跟随 `main`。

仓库Pages的Source为GitHub Actions；项目站继承`dinayuil.github.io`用户站的自定义域名；`github-pages`环境只允许`main`。新建仓库或迁移时，需在Settings → Pages选择GitHub Actions作为Source。

## Public APK

公开测试版 APK 的固定下载入口是 GitHub Releases 的滚动预发布：<https://github.com/dinayuil/french-grammar-app/releases/tag/apk-latest>。发布资产只有 `app-public-debug.apk` 和 `app-public-debug.apk.sha256`（可用 `sha256sum -c` 或等价工具校验）。在签名 Secrets 配置完成并成功自动构建前，该入口可能尚不存在。

`Build public debug APK` 工作流在 `main` 推送和 `content-public` 的 `content-updated` dispatch 成功构建后自动更新这个预发布。versionCode 使用 Actions run number（`1..2100000000`），versionName 为 `1.0-test.<run_number>`。手动触发和 `v*` 标签只构建 Actions artifact（名称 `app-public-debug`，保留 14 天），不刷新滚动入口；它们同样必须是 `main` 历史中的提交。发布前会核对应用 commit 和实际检出的 content-public commit 是否仍是各自 `main` 的 HEAD；过期构建、失败构建和已发布的相同或更高 versionCode 都不会覆盖当前下载入口。

自动测试包使用 Actions Secrets 中的固定测试签名。工作流只在从 `main` 可达的可信构建中使用这些 secrets（PR 不运行该工作流），缺失或不完整时构建失败，不会回退到随机 debug 证书，也不输出密码或把 keystore 写入仓库。keystore 只恢复到 runner 临时目录，并在构建结束时清理。

后续测试包可直接覆盖安装。首次从旧的临时 debug 签名迁移时，Android 可能要求先卸载旧版；卸载会清除本地 WebView 存储，本地学习进度不会随安装包迁移，请先记录需要保留的进度。

在 fork 或新仓库启用自动发布时，需要配置以下 5 个 Actions Secrets：

1. `FGE_PUBLIC_KEYSTORE_BASE64`：测试签名 keystore 的 base64 内容。
2. `FGE_PUBLIC_KEYSTORE_PASSWORD`：keystore 密码。
3. `FGE_PUBLIC_KEY_ALIAS`：签名 key 别名。
4. `FGE_PUBLIC_KEY_PASSWORD`：签名 key 密码。
5. `FGE_PUBLIC_CERT_SHA256`：证书 SHA-256 指纹（`apksigner verify --print-certs` 输出，可带冒号）。

配置后从 `main` 触发一次构建；工作流会验证包名 `com.fge.open`、versionCode/versionName 和实际签名指纹后再发布。不要把 keystore、密码、证书文件或本机路径提交到公开仓库。

### 运维前提与信任边界

- 发布 job 硬性校验当前仓库为 `dinayuil/french-grammar-app`；复制到其他仓库不会自动发布，启用前需明确修改仓库常量。
- `workflow_dispatch` 的 `content_ref` 和 dispatch 实际 content commit 必须来自 `content-public` 的 `main` 历史；未合并的分支/tag 内容会在 `npm ci`/签名前被拒绝，`main` 祖先的手工回滚允许构建但自动发布 freshness 会跳过。
- `apk-latest` 必须是可变的滚动标签：tag ruleset、immutable releases 或分支保护不得阻止工作流对它做 force 更新（`v*` 标签不在本机制内，也不会被修改）。
- 保持本 workflow 的文件身份和触发连续性。删除/重建 workflow 会使 Actions run_number 重新计数；若重建或重置版本基线，先把新构建的 versionCode 设置为高于已发布值，禁止倒退，否则发布 job 会按版本检查跳过。
- Release notes 中的 `- versionCode: \`N\`` 与匹配的 `- versionName: \`1.0-test.N\`` 是发布状态标记。手工修改、删除或使二者不一致后，发布 job 会失败关闭；恢复时将标记改回最后一次已发布版本（或删除/修复该 Release）后重跑，不要添加第三个 metadata 资产。若历史/手工操作造成 published marker 已写入但资产缺失，同版本会按策略跳过；用下一次更高 run_number 的自动构建，或手动修复/删除该 Release 后重跑。
- 发布中断可重跑恢复：已发布 Release 只在资产上传/校验和滚动 tag 更新后才写 notes 版本标记，未写入前重跑会重新上传并完成；新 Release 先以 draft 存在，资产失败时重跑会复用 draft、重新上传校验后再发布，不会被 published version 检查锁死。
- 签名 5 个 Secret 目前是仓库级 Actions Secrets。任何能修改公开仓库 workflow 的写权限协作者都能引用这些 secrets，因此这是“可信维护者”信任模型，不是硬隔离。若需更强控制，应把 5 项放入有 ref/环境保护和 required reviewers 的 GitHub Environment，并把 release/build job 绑定到该 environment；当前实现未配置 environment，不要声称已完成该隔离。

## 内容模式

公开版使用公开题库。内容仓库不是本仓库的一部分，而是与本仓库同级的独立仓库：

```text
工作目录/
├─ app/
└─ content-public/
```

构建和测试时把公开题库检出到同级`content-public/`，或设置`FGE_PUBLIC_CONTENT_DIR`：

```powershell
npm run dev
npm test
npm run build
npm run preview
npm run check:public
```

`FGE_PUBLIC_CONTENT_DIR`：公开题库根目录（默认`../content-public`）。如果覆盖了公开题库路径，文件守卫也必须指定相同目录；它不会自动读取该环境变量：

```powershell
npm run check:public -- --public "$env:FGE_PUBLIC_CONTENT_DIR"
```

公开题库已开始接入原创内容，具体覆盖以公开题库README为准。加载器仍支持合法空库；没有可用题目时首页提示“原创题库正在准备中”，不能开始练习，统计和设置仍可使用。真实公开题库测试要求非空，空状态另用显式测试数据回归。

无参数的`npm test`包含原生Node脚本测试和Vitest测试。附带任何Vitest参数（包括文件筛选或reporter标志）时只运行Vitest，跳过Node阶段；完整验收请使用无参数命令。单独验证文件守卫使用`node --test scripts/check-public.test.mjs`。

学习进度保存在当前浏览器／WebView的本地存储，按访问origin隔离；网页、不同网址和安装包之间不会自动同步进度。

## Android

Android的web资源、Capacitor配置和插件工程由同步步骤重新生成，不提交。请使用仓库提供的打包包装命令，不要直接调用裸`assemble`：

```powershell
npm run apk
```

| 模式 | Android应用标识 | debug APK |
|---|---|---|
| public | `com.fge.open` | `android/app/build/outputs/apk/public/debug/app-public-debug.apk` |

Windows也可使用`build-apk.bat public`。打包按网页构建→Capacitor同步→Gradle顺序执行；若意外中断留下`android/.fge-apk.lock`，先确认相关打包和Gradle进程已经停止，再清理这个锁文件。

公开版名称为“法语语法练习”。debug 构建仅用于本地和测试分发，不用于商店发布；自动发布的公开测试包使用独立测试签名，详见上一节。

## 隐私边界

- 本仓库只应包含应用代码、通用配置、通用Android模板和原创测试夹具。
- 不提交题库内容、第三方素材、PDF、截图、本机SDK路径、签名材料或构建产物。
- `.gitignore`只是防误提交措施，不是安全边界；提交前仍需检查完整文件列表与历史。
- `check:public`检查公开应用与公开题库的候选文件集合及来源标记；它是清单检查，不是版权或原创性证明。

## 部署边界

GitHub Pages只发布`dist/public`，不包含Android产物或任何非公开内容。网页版与Android debug构建相互独立。
