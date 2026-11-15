# 发布与签名维护

本文件维护网页版部署、Android / 鸿蒙 / Windows 打包、签名、Actions 配置及发布故障恢复。开发环境、内容路径与日常测试见[开发文档](development.md)；面向使用者的产品说明见[README](../README.md)。这里记录维护规则，不记录逐次构建进度或版本计数。

## 公开网页版

- 访问地址：<https://blog.yosorano.cc/french-grammar-app/>
- 工作流：`.github/workflows/deploy-pages.yml`
- 触发：应用 `main` 推送、`content-updated` 通知，或在 `main` 上手动触发。

工作流检出公开题库的 `main`，或通知携带的实际提交，运行完整公开测试与 `check:public`，再构建 `dist/public`。构建基路径来自 `actions/configure-pages` 的 `base_path`。

上传前检查 `index.html` 非空、包含 `id="root"`，引用的 JS 资源存在、非空且路径匹配。部署后运行外部冒烟检查：自定义域名边缘返回 403/429 时告警并跳过，404/500 或空资源仍判定失败。

仓库 Pages 的 Source 应设为 **GitHub Actions**，`github-pages` environment 只允许 `main`。项目站继承账号用户站的自定义域名，`https://dinayuil.github.io/french-grammar-app/` 会跳转到上述访问地址。

公开题库 `main` 推送会通过 `repository_dispatch` 触发部署，无需为每次内容更新修改应用仓库变量。手动重试或回滚时，用 `workflow_dispatch` 的 `content_ref` 指定内容 SHA、分支或标签。只有 `.github/workflows/ci.yml` 读取仓库变量 `CONTENT_PUBLIC_REF`，用于固定 CI 测试内容；未设置则跟随内容 `main`。Pages 和 APK 不读取该变量，使用各自的 `content_ref` 输入、通知中的提交或默认 `main`。两者分别构建和发布，不能以其中一个成功推断另一个成功。

## 本地 Android 构建

需要 JDK 21、Android SDK，并配置 `JAVA_HOME` 与 `ANDROID_HOME`。CI 安装的平台和工具为 `android-36`、`build-tools;36.0.0`；网页依赖安装方式见[开发文档](development.md)。

从应用目录运行：

```powershell
npm run apk
```

Windows 也可使用 `build-apk.bat public`。使用打包包装命令，避免直接运行裸 `assemble`：包装命令按网页构建 → Capacitor 同步 → 校验同步内容身份 → 指定 Gradle flavor 串行执行。

公开版名称为“法语语法练习”，包名为 `com.fge.open`，debug APK 位于：

```text
android/app/build/outputs/apk/public/debug/app-public-debug.apk
```

网页资源、Capacitor 配置与插件工程由同步步骤生成，不提交。如果中断后留下 `android/.fge-apk.lock`，先确认打包及 Gradle 进程均已停止，再清理该锁。

### 本地版本与签名输入

本地无覆盖参数时，公开版保留默认 `versionCode=1`、`versionName=1.0` 和本地 debug 签名。指定版本时必须同时设置：

- `FGE_PUBLIC_VERSION_CODE`：无前导零的正整数，范围 `1..2100000000`。
- `FGE_PUBLIC_VERSION_NAME`：1–64 位，以字母或数字开头，仅含字母、数字、`.`、`_`、`+`、`-`。

固定公开签名使用四个环境变量：`FGE_PUBLIC_KEYSTORE_PATH`、`FGE_PUBLIC_KEYSTORE_PASSWORD`、`FGE_PUBLIC_KEY_ALIAS`、`FGE_PUBLIC_KEY_PASSWORD`。四项必须完整，部分配置报错。设置 `FGE_REQUIRE_PUBLIC_SIGNING=1` 后，缺少签名也会报错，不回退临时证书。签名配置仅应用到公开 debug 变体。

从本机受限的凭据存储加载这些值，只传给构建进程；不要把密码放进命令行参数、日志、文档或仓库。debug 构建用于测试分发，不代表应用商店正式版本。

## 本地鸿蒙构建

安装 DevEco Studio 26.0.0 及配套 HarmonyOS SDK。首次模拟器镜像下载和账号授权在 IDE 内完成；之后可以在命令行构建。若工具安装在非默认目录，设置 `DEVECO_STUDIO_HOME` 指向 IDE 安装根目录。

```powershell
npm run harmony
```

包装命令在 `.fge-build/harmony/public/` 下独立构建公开网页，校验内容版本与资源完整性，再将模板和网页资源同步到同版本的生成工程，调用 OHPM 和 Hvigor。鸿蒙网页输出与普通 `dist/public/` 分离，避免其他平台的并发构建覆盖资源路径。打包过程中不运行 Capacitor 同步，也不改写 Android 工程。使用包装命令输出的 HAP 路径进行安装，不直接从源码模板执行构建。

生成工程可在 DevEco Studio 打开；用 HDC 安装和启动应用前，先在 Device Manager 启动模拟器，并通过 `hdc list targets` 确认连接。公开包名为 `com.fge.open`。模拟器可以接受此流程生成的未签名调试 HAP；该产物不代表真机可安装的正式发布包。

默认公开版产物与安装命令如下，`hdc` 可通过 SDK 的 `toolchains` 目录调用：

```powershell
hdc list targets
hdc install -r .fge-build/harmony/public/project/entry/build/default/outputs/default/entry-default-unsigned.hap
hdc shell aa start -a EntryAbility -b com.fge.open
```

源码模板不包含网页构建结果、签名或本机路径。生成工程、HAP、依赖缓存和 IDE 本地文件不提交；尤其不要把打包后的 `rawfile` 资源复制回模板。鸿蒙正式证书、真机签名、商店发布与自动发布流水线需要另行配置，不能复用 Android 签名材料。

覆盖安装时应保留同一包名和页面 origin，避免主动清除 WebStorage。卸载会删除进度，卸载前先导出备份。正式发布前须验证覆盖升级、备份导入导出、系统分享、主题和真实设备表现。

## 本地 Windows 构建

使用 Windows、Node.js、稳定版 Rust MSVC 工具链，以及 Visual Studio C++ 桌面开发工具和 Windows SDK。开发运行需要 WebView2。先安装应用依赖，再执行：

```powershell
npm run windows
```

内部版本使用 `npm run windows:internal`。包装脚本先检查前端类型与公开/内部身份，再向 `.fge-build/windows/<edition>/web/` 单独构建前端；不复用 `dist/public` 或鸿蒙输出。Rust 编译目录为该版下的 `target/`。打包需取得 NSIS 和 WebView2 运行时安装程序，构建机需要可访问对应下载源；“完整离线包”指用户安装时无需联网，不表示首次构建无需网络。

公开版最终产物位于 `.fge-build/windows/public/packages/`：

- `fge-windows-public-standard-setup.exe`：缺少 WebView2 时联网补装。
- `fge-windows-public-offline-setup.exe`：附带 WebView2 离线安装程序。
- `manifest.json`：记录两种包的身份、大小、SHA-256 和安装模式，发布前应核对。

两种安装包必须使用同一二进制、应用身份、页面来源和用户数据目录。公开/内部版身份不同，禁止混用题库或输出。修改 Tauri 的 identifier、页面 scheme 或存储路径会影响原进度访问，不可作为普通升级随意变更。覆盖升级、取消文件保存、断网启动与高 DPI 缩放均需验收。

默认产物没有正式 Windows 代码签名，不能标为正式签名版本。正式发行前按 [Tauri Windows 签名说明](https://v2.tauri.app/distribute/sign/windows/) 配置独立证书与发布环境，并在目标 Windows 安全策略下检查安装和首次运行；不复用 Android 签名材料。Windows 测试包由 Actions 自动构建，与固定签名 Android APK 一起发布到 [`client-latest` 预发布](https://github.com/dinayuil/french-grammar-app/releases/tag/client-latest)，不设独立 Windows 发布页。

本地命令用于开发验收；公开发布使用同一次 Actions 构建的产物。发布前必须同时确认 Android 与 Windows 构建成功、应用与公开题库提交一致、安装包 hash 正确；对应源码必须已进入应用 main，题库必须来自公开题库 main。发布页必须注明 Windows 未签名测试版及已完成的验证范围，不能把本机 HTTP 联调写成第三方服务或安装升级已验收。不得上传内部版、私有内容、原始构建目录或本机追溯文件。

## 客户端同步验收

WebDAV 仅在 Windows、Android、鸿蒙客户端启用。测试使用专门的根目录和测试账号，不指向已有生产备份。HTTP 和 HTTPS 均支持，包括局域网地址及自定义端口；Android 明文网络策略必须实际允许 HTTP。使用者输入 WebDAV 根地址，应用通过 MKCOL 自动创建 `FrenchGrammarExercise/`；目录已存在时，用 Depth: 0 的 PROPFIND 验证 collection，再读写其中当前版本的固定同步文件。目录创建或验证失败必须停止，不能回退向用户根目录直接写文件。

服务还需要强 ETag 以及 `If-Match` / `If-None-Match` 条件写；无效或缺失版本标记必须停止覆盖。用户不填写同步 JSON 路径。新目录布局使用独立的基线作用域，旧布局恢复副本继续可导出；旧根目录文件不自动移动或删除。

至少验证两设备交替学习、两边离线修改形成冲突、412 竞争、请求期间继续学习、改账号、断开重连、重装为空、错误密码、断网重试及恢复副本导出。同步错误不得中断本地学习；双边修改不得自动相加；运行中切换配置不得向新目标应用旧基线。凭据只在系统加密存储中保存，不能出现在日志、截图、manifest 或进度备份中。

Android 使用应用 Keystore，鸿蒙使用 HUKS，Windows 使用当前用户 DPAPI；复制密文文件到另一设备不应当作迁移凭据的方法。同步云端文件本身是普通 JSON，未实现额外的端到端口令加密。用户选择第三方存储后，相关联网行为、数据去向与隐私说明需与实际安装包保持一致。

## 客户端自动构建与预发布

- 工作流：`.github/workflows/build-public-apk.yml`
- 固定入口：<https://github.com/dinayuil/french-grammar-app/releases/tag/client-latest>
- 资产：`app-public-debug.apk`、`fge-windows-public-standard-setup.exe`、`fge-windows-public-offline-setup.exe`，以及各自的 `.sha256` 校验文件，共六个。

发布标题为“客户端公开测试版（滚动更新）”。旧 `apk-latest` 保留历史下载，不再自动更新，避免旧链接立即失效。保留工作流文件名 `build-public-apk.yml` 以延续 Android 的 run_number 与版本号；发布入口已与文件名解耦。

应用 `main` 推送及公开题库的 `content-updated` 通知，在 Android 与 Windows 两端构建都成功后更新滚动预发布。流水线先解析并固定同一对应用/公开题库提交，再分别执行 Linux Android 构建与 Windows 两种安装包构建；任一失败或提交不一致均不更新 Release。手动触发与 `v*` 标签只构建 Actions artifact，不刷新该入口；artifact 保留 14 天。

应用与实际检出的内容提交都必须位于各自 `main` 历史。未合并的分支或标签所指提交会在依赖安装、签名前被拒绝。`main` 祖先的手工回滚可以构建；自动发布还要求应用和内容提交分别等于当前 `main` HEAD，过期构建不会覆盖新包。

Android 自动构建的 `versionCode` 使用该 workflow 的 `run_number`，`versionName` 为 `1.0-test.<run_number>`。构建后验证公开包名、版本、唯一签名证书指纹和 APK 哈希；Windows 构建校验两包身份、安装模式与哈希，再分别上传精确的公开产物。独立发布 job 只下载本 run 的产物，复核提交、文件清单和哈希后统一更新 `client-latest`，不会执行仓库构建代码；build job 为 `contents: read`，发布 job 单独使用 `contents: write`。

下载后可用以下命令或等价工具核验：

```text
sha256sum -c app-public-debug.apk.sha256
sha256sum -c fge-windows-public-standard-setup.exe.sha256
sha256sum -c fge-windows-public-offline-setup.exe.sha256
apksigner verify --verbose --print-certs app-public-debug.apk
aapt2 dump badging app-public-debug.apk
```

固定签名的后续版本可覆盖安装。早期临时 debug 签名不同的安装包可能需要先卸载；卸载会清除本地 WebView 数据，安装包不会迁移学习记录。

## 签名 Secrets 与启用条件

Actions 需要以下 5 项：

1. `FGE_PUBLIC_KEYSTORE_BASE64`：测试签名 keystore 的 base64 内容。
2. `FGE_PUBLIC_KEYSTORE_PASSWORD`：keystore 密码。
3. `FGE_PUBLIC_KEY_ALIAS`：签名 key 别名。
4. `FGE_PUBLIC_KEY_PASSWORD`：签名 key 密码。
5. `FGE_PUBLIC_CERT_SHA256`：对应证书的 SHA-256 指纹，可带冒号。

配置后，由一次应用 `main` 推送或 `content-updated` 通知触发自动构建，验证构建和 Release 的完整链路。手动运行只验证构建，不用于刷新滚动发布。缺失或不完整的签名配置会明确失败。keystore 只恢复到 runner 临时目录，使用受限权限并在结束时清理，不进入 artifact 或仓库。

维护约束：

- 发布逻辑限定仓库 `dinayuil/french-grammar-app`。fork 或迁移仓库时，除了配置 Secrets，还需明确修改工作流中的仓库常量。
- `client-latest` 必须保持可变，tag ruleset 和 immutable releases 不能阻止该标签滚动更新。其他 `v*` 标签不被这个机制改动。
- 保持 workflow 文件身份与 `run_number` 连续性。重建、重置或迁移工作流时，须确保版本号高于已发布版本；否则新构建会被版本检查跳过。
- Secrets 当前为仓库级，信任拥有 workflow 写权限的维护者；文件内的 main 检查不能阻止有写权限者改写工作流来引用 Secrets。开放协作前，应把签名配置迁入具有 ref 保护和必要审批的 GitHub Environment，并绑定相应 job。
- 私钥及凭据必须留有受控的持久存储，不能依赖 GitHub Secrets 读回原值。不要向仓库提交 keystore、密码、证书文件或本机路径。

## 发布失败恢复

首次发布先创建 draft，资产上传并校验后才公开；失败重跑会复用 draft。已有发布先上传 Android APK、两种 Windows 安装包及各自校验文件，核对六个资产，再更新滚动 tag，最后写入说明中的版本标记。未完成标记写入的运行可以重跑恢复；上传期间的短暂不一致会在重跑后收敛。

Release notes 中以下两行是发布状态标记，不能任意删除或修改：

```text
- versionCode: `N`
- versionName: `1.0-test.N`
```

已发布的相同或更高 `versionCode` 会被跳过。标记缺失或互相不匹配时，发布会明确失败；将其恢复为最后一次已发布版本后再重跑。若手工操作或历史故障造成标记已写入、资产却缺失，可用下一次更高 `run_number` 的自动构建修复，或修复/删除该 Release 后重跑，不额外上传 metadata 资产。

客户端发布、Pages 部署分别查看对应 Actions 结果；上游通知成功只表示 dispatch 已送达。
