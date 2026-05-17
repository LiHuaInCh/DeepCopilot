# Deep Copilot Desktop

<p align="center">
  <img src="imgs/logo.png" alt="Deep Copilot" width="160" style="border-radius:16px"/>
</p>

<p align="center">
  <b>AI 编程助手桌面版 · 由 DeepSeek V4 驱动</b><br/>
  <sub>VS Code 扩展 DeepCopilot 的独立 Electron 移植版</sub>
</p>

<p align="center">
  <a href="https://github.com/LiHuaInCh/DeepCopilot/releases/download/v0.1.0/DeepCopilot-v0.1.0.zip">
    <img src="https://img.shields.io/badge/📥_下载-Windows_便携版_v0.1.0-0078d4?style=for-the-badge" alt="下载"/>
  </a>
</p>

<p align="center">
  <a href="https://github.com/ZhouChaunge/DeepCopilot"><img src="https://img.shields.io/badge/原项目-DeepCopilot-blue" alt="Original"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License"/></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform"/>
</p>

> 无需 VS Code，无需 Docker，无需 Node.js。解压即用。通过 DeepSeek API（兼容 OpenAI）驱动。

## 下载

点击上方蓝色按钮下载，解压后双击 `DeepCopilot.exe` 运行。

首次启动点击右下角 🔑 设置 DeepSeek API Key（从 [platform.deepseek.com](https://platform.deepseek.com/api_keys) 获取）。

## 功能

- AI Agent 对话（DeepSeek V4 Pro / Flash / Reasoner）
- 文件读写、代码搜索、Shell 执行
- 联网搜索（Tavily）、MCP 扩展、子 Agent
- 会话管理、Plan/Todos、审批模式
- 系统托盘、拖拽文件、文件树
- 对话导出、主题跟随、余额显示
- 中英双语界面

## 开发者

```bash
git clone https://github.com/LiHuaInCh/DeepCopilot.git
cd DeepCopilot
git checkout desktop
npm install
npm start
```

打包：

```bash
npm run dist
```

## 项目结构

```
├── electron/          # Electron 主进程
│   ├── main.js        # 入口
│   ├── preload.js     # contextBridge
│   └── agent-bridge.js
├── src/               # 核心逻辑
│   ├── api/           # DeepSeek API
│   ├── chat/          # Agent 循环
│   └── tools/         # 工具实现
├── webview/           # 前端 UI
└── imgs/              # 图片
```

## License

MIT © [ZhouChaunge](https://github.com/ZhouChaunge)

---

> 桌面版由 [LiHuaInCh](https://github.com/LiHuaInCh) 移植
