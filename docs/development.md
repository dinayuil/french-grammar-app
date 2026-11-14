# 开发与内容接入

本文件维护开发环境、目录职责、公开题库接入和日常验证命令。产品功能与使用入口见[README](../README.md)；网页部署、APK 构建、签名和自动发布见[发布与签名维护](releases.md)。修改相应配置时更新这里的说明，不在产品 README 重复维护。

## 项目结构

应用使用 React 18、TypeScript、Vite 和 Capacitor。应用代码与公开题库分别维护：

- [应用仓库](https://github.com/dinayuil/french-grammar-app)
- [公开题库仓库](https://github.com/dinayuil/french-grammar-content-public)

目录职责：

- `src/`：界面、判题、进度、音效与通用校验代码。
- `build/`：内容加载、构建配置与相关测试。
- `scripts/`：内容模式、公开清单检查及 APK 打包脚本。
- `android/`：Capacitor Android 原生工程模板；同步和构建生成的内容不提交。
- `dist/public/`：公开版网页构建输出，不提交。
- `docs/`：开发与发布维护文档。

## 环境与启动

建议使用 Node.js 22（与 CI 一致）及 npm，按 `package-lock.json` 安装依赖。Android 额外要求见[发布文档](releases.md#本地-android-构建)。

将应用与公开题库放在同级目录：

```text
workspace/
├─ app/
└─ content-public/
```

```powershell
git clone https://github.com/dinayuil/french-grammar-app.git app
git clone https://github.com/dinayuil/french-grammar-content-public.git content-public
cd app
npm ci
npm run dev
```

## 公开题库接入

公开版默认读取 `../content-public`。需要其他位置时，设置 `FGE_PUBLIC_CONTENT_DIR` 指向公开题库根目录，再运行开发、测试或构建命令。

```powershell
$env:FGE_PUBLIC_CONTENT_DIR = "D:/workspace/content-public"
npm run dev
```

文件守卫不自动读取该环境变量；覆盖路径后，必须显式检查同一份内容：

```powershell
npm run check:public -- --public "$env:FGE_PUBLIC_CONTENT_DIR"
```

题库内容与覆盖范围以题库仓库的 `manifest.json` 和 README 为准。加载器支持合法空库：空库下不能开始练习，统计和设置仍可使用。真实公开题库的集成测试要求非空，空状态由独立测试夹具覆盖。

## 日常命令

从应用目录执行：

```powershell
npm run dev           # 本地开发
npm test              # 完整公开测试
npm run build         # 构建公开网页
npm run preview       # 预览构建结果
npm run check:public  # 检查公开文件与内容清单
```

无参数的 `npm test` 包含原生 Node 脚本测试和 Vitest 测试。附带 Vitest 参数时只运行 Vitest，会跳过 Node 阶段；不能用聚焦测试代替完整验收。

```powershell
npm test -- src/home-hero.test.tsx       # 聚焦 Vitest 测试
node --test scripts/check-public.test.mjs
```

CI 中的 Android 配置测试会实际执行 Gradle 自带的 Groovy 运行时。所有运行完整测试的工作流都必须先准备 JDK 21 和 Gradle 分发包：

```powershell
cd android
.\gradlew.bat --version
cd ..
npm test
```

Linux/CI 对应使用 `bash ./gradlew --version`。CI 缺少该运行时会报错；本地未安装 Gradle 时，相应测试可能跳过。

## 数据与公开仓库边界

学习进度保存在当前浏览器或 WebView 的本地存储，按 origin 隔离；不同网址、网页与安装包之间不会自动同步。清除站点数据或卸载应用会清除对应记录。

公开仓库只保留应用代码、通用配置、Android 模板、维护文档和原创测试夹具。不提交题库正文、第三方素材、PDF、截图、本机 SDK 路径、签名材料或构建产物。单元测试使用合成夹具，公开题库集成测试读取独立的公开题库。

`.gitignore` 只用于防误提交；提交前仍应审查暂存文件与历史。`check:public` 验证公开候选文件的清单与来源标记，不代表版权或原创性认证。GitHub Pages 只发布 `dist/public`，不包含 Android 产物或其他内容。
