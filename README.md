# 法语语法练习

面向中文学习者的法语语法学习应用。把知识讲解、互动练习和错题复习放在一起，按专题和小章逐步学习，并记录每天的学习进度。

**[打开网页版](https://blog.yosorano.cc/french-grammar-app/)** · **[下载 Android 测试版](https://github.com/dinayuil/french-grammar-app/releases/download/client-latest/app-public-debug.apk)** · **[下载 Windows 测试版](https://github.com/dinayuil/french-grammar-app/releases/download/client-latest/fge-windows-public-standard-setup.exe)**

## 可以做什么

- **按主题学语法**：从专题进入小章，阅读对应讲解，按自己的节奏完成练习。
- **查阅知识点**：搜索讲解内容，通过目录定位卡片，随时复习容易混淆的规则。
- **做互动练习**：选择题、字母拼词和词块组句，配合答案解析与可选翻译。
- **巩固错题**：自动记录答错的题，集中复习易错知识点。
- **查看学习进度**：每日 XP 目标、等级、连续学习天数、学习时长和统计分享卡。
- **调整学习体验**：深浅色主题、音效开关，以及翻译的显示方式。

## 怎么开始

1. 打开网页版，或安装 Android 测试版，无需注册账号。
2. 选择一个专题和小章，可以先看讲解，再做对应练习。
3. 通过错题复习巩固知识，在统计页查看学习记录。

## 学习记录

进度默认保存在当前浏览器或客户端本地。网页版不提供云同步；客户端可自行配置下述 WebDAV 同步。清除浏览器站点数据或卸载应用可能清除对应的学习记录。

可以在设置中的“学习进度备份”导出 JSON 文件，再在另一设备的网页版或客户端中选择文件恢复。Windows 使用另存为，Android 与鸿蒙通过系统分享面板导出；请把文件保存到自己可以找回的位置。

导入前会显示备份摘要，确认后整份替换当前进度，不会合并两份记录。恢复范围包括 XP、关卡完成与星级、错题、每日学习记录，以及目标、音效和翻译设置；主题设置不随备份迁移。成功导入后可以恢复上次导入前的记录，但这份回退记录仍保存在本机，不能代替外部备份。

仅支持本应用导出的、不超过 5 MB 的同版本题库备份；公开版网页与公开版 App 可以互相迁移。备份不包含题库正文或购买权益。建议在卸载应用、清除站点数据或换设备前导出并妥善保存。

## 客户端云同步

Windows、Android 与鸿蒙客户端可在设置中连接自己的 WebDAV 存储。填写 WebDAV 根地址、用户名与应用密码，支持 HTTP 和 HTTPS，也可连接局域网服务。应用会自动在该根目录下创建 `FrenchGrammarExercise/` 专属文件夹，不需要手动建目录或填写文件路径。连接后可手动同步，也可开启自动同步。服务需支持 WebDAV 目录操作、ETag 和条件写入；具体服务的兼容性需要验证。网页版没有此功能。

学习仍在本机完成，断网不影响使用；联网后再尝试同步。只有一端变化时同步整份进度；两台设备都产生新记录时，会显示双方摘要，由你选择保留哪一份，不会自动合并 XP、时长或错题。覆盖前保留的本机副本可导出为备份。新安装的空进度不会自动覆盖已有云端记录。

同步文件保存在你指定的服务中，包含学习记录与备份支持的练习设置，不包含题库或购买权益。本应用不提供账号服务器；应用密码由客户端的系统加密存储保护，不写入学习备份。断开连接不会删除云端文件，删除需在你自己的存储服务中操作。云端文件按普通 JSON 保存，其保密性依赖你的存储服务和账号权限。

## Android 测试版

目前通过 GitHub Releases 提供测试版 APK，尚未上架应用商店。后续测试版使用相同签名，可覆盖安装。

如果安装过早期使用不同签名的测试包，首次更换可能需要先卸载旧版；卸载会清除本地学习记录。

## Windows 软件

Windows 版为独立桌面软件，题库随安装包提供，安装后可离线学习。Windows 与 Android 测试包由自动构建统一发布，下载及校验文件均在[公开测试版发布页](https://github.com/dinayuil/french-grammar-app/releases/tag/client-latest)。当前 Windows 安装包未签名，Windows 可能显示未知发布者提示。

- **[标准安装包](https://github.com/dinayuil/french-grammar-app/releases/download/client-latest/fge-windows-public-standard-setup.exe)**：电脑缺少 WebView2 运行时时，安装过程会联网补装。
- **[完整离线安装包](https://github.com/dinayuil/french-grammar-app/releases/download/client-latest/fge-windows-public-offline-setup.exe)**：包含 WebView2 离线安装程序，适合断网安装，体积较大。

两种安装包的应用功能和身份相同。后续覆盖升级应使用同一公开版本，升级前仍建议导出学习进度备份。

## 鸿蒙适配

已加入 HarmonyOS 鸿蒙适配，支持离线学习、系统分享与学习进度备份导入导出，并已完成初步模拟器验证。目前尚未提供公开安装包，真机兼容性与正式签名仍待验证，尚未上架应用商店。

## 内容说明与反馈

讲解和习题由 **AI 参与编写与复核，尚未经过人工法语审校**。遇到可疑答案或表述，请结合其他学习资料核对。

公开内容见[原创题库仓库](https://github.com/dinayuil/french-grammar-content-public)。发现题目、讲解或应用问题，可以在 [Issues](https://github.com/dinayuil/french-grammar-app/issues) 中反馈，附上题目或讲解名称及复现步骤。

## 许可

本仓库的应用代码与文档采用 [MIT License](LICENSE)，允许在保留版权与许可声明的条件下使用、修改、分发和商业使用。

题库内容独立授权，不适用应用代码的 MIT 许可。公开题库采用 [CC BY-NC-SA 4.0](https://github.com/dinayuil/french-grammar-content-public/blob/main/LICENSE)；打包或分发应用时，也需要遵守所使用内容的授权条件。第三方依赖仍适用各自的许可证。
