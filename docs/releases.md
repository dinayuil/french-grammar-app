# 发布与签名维护

本文件维护公开网页版部署、Android 测试包、稳定签名、Actions 配置及发布故障恢复。开发环境、内容路径与日常测试见[开发文档](development.md)；面向使用者的产品说明见[README](../README.md)。这里记录维护规则，不记录逐次构建进度或版本计数。

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

## APK 自动构建与预发布

- 工作流：`.github/workflows/build-public-apk.yml`
- 固定入口：<https://github.com/dinayuil/french-grammar-app/releases/tag/apk-latest>
- 资产：`app-public-debug.apk`、`app-public-debug.apk.sha256`

应用 `main` 推送及公开题库的 `content-updated` 通知，在构建成功后更新滚动预发布。手动触发与 `v*` 标签只构建 Actions artifact，不刷新该入口；artifact 名为 `app-public-debug`，保留 14 天。

应用与实际检出的内容提交都必须位于各自 `main` 历史。未合并的分支或标签所指提交会在依赖安装、签名前被拒绝。`main` 祖先的手工回滚可以构建；自动发布还要求应用和内容提交分别等于当前 `main` HEAD，过期构建不会覆盖新包。

自动构建的 `versionCode` 使用该 workflow 的 `run_number`，`versionName` 为 `1.0-test.<run_number>`。构建后验证公开包名、版本、唯一签名证书指纹和 APK 哈希，再上传精确的公开 APK artifact。独立发布 job 只下载本 run 的该 artifact，复核哈希后更新 `apk-latest`，不会执行仓库构建代码；build job 为 `contents: read`，发布 job 单独使用 `contents: write`。

下载后可用以下命令或等价工具核验：

```text
sha256sum -c app-public-debug.apk.sha256
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
- `apk-latest` 必须保持可变，tag ruleset 和 immutable releases 不能阻止该标签滚动更新。其他 `v*` 标签不被这个机制改动。
- 保持 workflow 文件身份与 `run_number` 连续性。重建、重置或迁移工作流时，须确保版本号高于已发布版本；否则新构建会被版本检查跳过。
- Secrets 当前为仓库级，信任拥有 workflow 写权限的维护者；文件内的 main 检查不能阻止有写权限者改写工作流来引用 Secrets。开放协作前，应把签名配置迁入具有 ref 保护和必要审批的 GitHub Environment，并绑定相应 job。
- 私钥及凭据必须留有受控的持久存储，不能依赖 GitHub Secrets 读回原值。不要向仓库提交 keystore、密码、证书文件或本机路径。

## 发布失败恢复

首次发布先创建 draft，资产上传并校验后才公开；失败重跑会复用 draft。已有发布先上传 APK 和校验文件、核对资产集合，再更新滚动 tag，最后写入说明中的版本标记。未完成标记写入的运行可以重跑恢复；上传期间的短暂不一致会在重跑后收敛。

Release notes 中以下两行是发布状态标记，不能任意删除或修改：

```text
- versionCode: `N`
- versionName: `1.0-test.N`
```

已发布的相同或更高 `versionCode` 会被跳过。标记缺失或互相不匹配时，发布会明确失败；将其恢复为最后一次已发布版本后再重跑。若手工操作或历史故障造成标记已写入、资产却缺失，可用下一次更高 `run_number` 的自动构建修复，或修复/删除该 Release 后重跑，不添加第三个 metadata 资产。

APK 发布、Pages 部署分别查看对应 Actions 结果；上游通知成功只表示 dispatch 已送达。
