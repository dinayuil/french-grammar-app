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

公开网页版由`.github/workflows/deploy-pages.yml`在`main`推送或`main`上手动触发时部署。工作流检出`content-public`的固定提交，运行完整公开测试和`check:public`后构建`dist/public`；构建基路径由`actions/configure-pages`的`base_path`决定。上传前会本地校验构建产物：`index.html` 非空且含 `id="root"`，引用的 JS 资源存在、非空并与基路径匹配。部署后的外部冒烟检查为尽力而为：自定义域名的边缘可能以 403/429 拦截 GitHub Actions，此时只告警并跳过；404/500 或空资源仍会导致检查失败。

账号用户站启用自定义域名时，`https://dinayuil.github.io/french-grammar-app/`会跳转到上面的自定义域名。公开题库更新时，同步更新`.github/workflows/deploy-pages.yml`与`.github/workflows/ci.yml`中的`CONTENT_PUBLIC_REF`。

仓库Pages的Source为GitHub Actions；项目站继承`dinayuil.github.io`用户站的自定义域名；`github-pages`环境只允许`main`。新建仓库或迁移时，需在Settings → Pages选择GitHub Actions作为Source。

## Public APK

公开版 APK 由 `Build public debug APK` 工作流构建，在 `main` 推送、`v*` 标签或手动触发时运行。手动触发或标签构建必须指向 `main` 上的提交；未合并的功能分支引用会被工作流拒绝。工作流使用固定的公开题库提交，只构建公开版 debug APK，不上架应用商店，也不进行发布签名。构建产物以 `app-public-debug` 为 artifact 名称上传，保留 14 天。

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

公开版名称为“法语语法练习”。debug APK仅供本地测试，不用于商店发布。

## 隐私边界

- 本仓库只应包含应用代码、通用配置、通用Android模板和原创测试夹具。
- 不提交题库内容、第三方素材、PDF、截图、本机SDK路径、签名材料或构建产物。
- `.gitignore`只是防误提交措施，不是安全边界；提交前仍需检查完整文件列表与历史。
- `check:public`检查公开应用与公开题库的候选文件集合及来源标记；它是清单检查，不是版权或原创性证明。

## 部署边界

GitHub Pages只发布`dist/public`，不包含Android产物或任何非公开内容。网页版与Android debug构建相互独立。
