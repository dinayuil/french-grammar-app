# 开发与内容接入

本文件维护开发环境、目录职责、公开题库接入和日常验证命令。产品功能与使用入口见[README](../README.md)；网页部署、APK 构建、签名和自动发布见[发布与签名维护](releases.md)。修改相应配置时更新这里的说明，不在产品 README 重复维护。

## 项目结构

应用使用 React 18、TypeScript、Vite 和 Capacitor。应用代码与公开题库分别维护：

- [应用仓库](https://github.com/dinayuil/french-grammar-app)
- [公开题库仓库](https://github.com/dinayuil/french-grammar-content-public)

目录职责：

- `src/`：界面、判题、进度、音效与通用校验代码。
- `build/`：内容加载、构建配置与相关测试。
- `scripts/`：内容模式、公开清单检查及原生打包脚本。
- `android/`：Capacitor Android 原生工程模板；同步和构建生成的内容不提交。
- `harmony/`：鸿蒙 ArkTS / ArkWeb 工程模板；网页资源和构建配置在打包时同步至生成工程。
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

## 多语言维护

课程目标语言固定为法语；界面和辅助学习内容首期注册 `zh-CN`、`fr`。语言偏好使用独立本地存储，不属于 `Progress`、备份或 WebDAV 同步数据。不要通过改变 WebView 来源或进度存储键实现语言切换。

职责划分：

- `src/i18n/types.ts` 维护界面和内容覆盖语言注册表。
- `src/i18n/zh-CN.ts`、`fr.ts` 聚合类型化消息目录；reading、practice、sharing 域文件分别维护对应文案。新增键须同时提供两种语言，使用同名 `{name}` 插值参数。
- `src/i18n/messages.ts` 提供 `t` 与目录完整性检查；`format.ts` 维护日期、数字和学习时长，原 `formatStudyDuration.ts` 仅保留兼容入口。
- `src/i18n/LocaleProvider.tsx` 根据设置页的语言偏好和当前版本支持列表解析生效语言。默认按浏览器或 WebView 提供的系统语言顺序匹配，支持地区变体并响应 `languagechange`。
- `src/content/localize.ts` 解析只读展示模型；评分、错题和进度仍持有原实体与稳定 ID。本地化选项仅用于显示，不能成为判分答案。

内容在所属内容仓库新增 `locales.fr`，不放进应用文案目录。保留全部原始字段和中文 `translation`，法语模式由统一策略隐藏句子译文；讲解 `body`、解析 `explain` 仍需完整法语内容。章节法语标题使用现有 `titleFr`，不重复写 `locales.fr.title`。公开小章标题通过 `locales.fr.sectionTitles[sectionKey]` 对应 app 的既有普通小章 key，综合区默认标签来自 UI 文案。

每版 manifest 的 `supportedLocales` 决定可选语言，缺省仅中文。纯法语基础字段可以在 `localizationSharedFields.fr` 中按实体 ID 显式裁定复用；复用不能与同字段覆盖并存，不能把含中文内容当作法语复用。`collectLocalizationGaps` 报告未覆盖且未裁定的字段；声明 `fr` 后构建要求零缺项。UI 消息目录无论版本均须键、非空文案和插值参数一致，构建会执行同一校验。

翻译题干时保留 `___`、`...` 的数量与顺序及字母题补全锚点。旧 `(第N空)` 只用于兼容读取；对应 choice 题可用一致的顶层 `blankTarget` 明确目标空位，法语展示不保留中文标记。任何语言都不能改变原 ID、答案、可接受答案、题型、顺序、归属和选项下标。

新增语言时先扩注册表、消息目录和内容覆盖，再通过完整性门槛加入 manifest。无匹配的系统语言或已存语言暂不可用时回退简体中文。英语在当前版本通过完整性校验并启用后，回退语言改用英语。手动偏好会保留至对应语言包恢复，选择「跟随系统」会清除手动偏好。

错误使用稳定 `code`、非敏感 `params` 与独立诊断信息；主提示按当前语言即时格式化，不通过匹配中文异常推断错误类型。应用可控的原生保存对话框标题由 JS 传入；操作系统控制的系统界面语言仍由系统决定。Android 与鸿蒙目前仅声明系统自动授予的网络权限，没有另加权限说明弹窗。

常用聚焦验证（完整验收仍运行下节的无参数测试与构建）：

```powershell
npm test -- src/i18n/messages.test.ts src/content/localizationCoverage.test.ts
npm test -- src/locale-app.test.tsx src/locale-learning.test.tsx src/locale-reading.test.tsx
npm test -- src/share/statsCard.test.ts src/share/shareStats.test.ts
```

内部版本使用对应的 `test:internal`、`build:internal` 脚本，在自己的内容根独立验收语言覆盖。翻译还需核对教学含义、例外、反例与例句；结构、覆盖和字符检查不等于专业人工法语审校。

## 日常命令

从应用目录执行：

```powershell
npm run dev           # 本地开发
npm test              # 完整公开测试
npm run build         # 构建公开网页
npm run preview       # 预览构建结果
npm run check:public  # 检查公开文件与内容清单
npm run harmony       # 构建鸿蒙公开调试包，环境要求见发布文档
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

## 鸿蒙开发方式

鸿蒙复用相同的 React 页面、题库管线和备份格式。ArkWeb 容器使用固定页面来源 `https://fge.local`，在应用内将请求映射到打包资源；该地址不需要 DNS、服务器或网络连接。容器开启 DOM Storage，进度保存在应用的本地存储。不要随意修改 origin，否则原存储将无法直接读取；跨平台迁移使用进度备份。

平台相关的主题、文件导出与可选同步通过薄适配层分别调用 Capacitor、鸿蒙桥、Windows 原生命令或浏览器能力。鸿蒙不模拟 Capacitor 插件协议。文件导入继续使用页面文件选择器与既有备份校验和预览流程。

完整 IDE 便于管理 SDK 和模拟器；日常编辑、依赖安装、构建和设备连接也可由命令行完成。构建只向子进程传递工具环境，不修改全局 Java 或 Node 配置。命令与产物路径见[本地鸿蒙构建](releases.md#本地鸿蒙构建)。

## 数据与公开仓库边界

学习进度保存在当前浏览器或 WebView 的本地存储，按 origin 隔离。网页不提供同步；安装客户端可选连接自己的 WebDAV 服务。不要修改已发布客户端的应用身份、WebView 来源或数据目录，否则原本地进度可能不可见。清除站点数据或卸载应用前先导出备份。

客户端同步沿用 version 1 备份作为同步文件载荷，配置与凭据由原生适配器管理，密码不得放入 localStorage 或普通进度备份。共享状态机只保存非敏感的共同基线与恢复副本，使用强 ETag 和条件 PUT 检测竞争，不按设备时间决定覆盖。双边变化显示冲突，禁止对 XP、时长、错题累计直接相加。

WebDAV 配置 URL 表示根地址，接受 HTTP 和 HTTPS；客户端自动创建根下的 `FrenchGrammarExercise/`。原生只允许对这个固定目录执行 MKCOL / PROPFIND，对其中当前版本固定文件执行 GET / PUT，不允许调用方传任意路径。不要用只支持标准 HTTP 方法的底层客户端假装支持 DAV，也不要改变 WebView 本地页面来源来支持 HTTP 同步；网络请求应继续通过原生适配器执行。

公开仓库只保留应用代码、通用配置、原生工程模板、维护文档和原创测试夹具。不提交题库正文、第三方素材、PDF、截图、本机 SDK 路径、签名材料或构建产物。单元测试使用合成夹具，公开题库集成测试读取独立的公开题库。

`.gitignore` 只用于防误提交；提交前仍应审查暂存文件与历史。`check:public` 验证公开候选文件的清单与来源标记，不代表版权或原创性认证。GitHub Pages 只发布 `dist/public`，不包含 Android 产物或其他内容。
