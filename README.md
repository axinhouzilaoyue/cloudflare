# GLaDOS 签到 Cloudflare Worker

一个基于 Cloudflare Worker 的 GLaDOS 自动签到工具，支持多账号管理和 Telegram 通知功能。

## 📝 签到结果示例
<img width="368" alt="image" src="https://github.com/user-attachments/assets/57ef78b1-1f41-4e87-b307-e68cdd3e304a" />

## ✨ 功能特点
- 🔄 自动执行 GLaDOS 每日签到
- 👥 支持多账号管理
- 📊 查询账号剩余天数
- 📱 Telegram 消息通知
- ⏱️ 支持定时任务自动执行
- 🔒 安全存储账号信息

## 🚀 部署指南

### 1. 创建 Cloudflare Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 `Workers & Pages` 页面
3. 点击 `Create application`
4. 选择 `Create Worker`
5. 将 `worker4glados.js` 的代码复制到编辑器中
6. 点击 `Save and Deploy`

### 2. 配置账号信息

有两种方式配置账号信息：

#### 方式一：使用环境变量（推荐）

1. 在 Worker 详情页面，点击 `Settings` > `Variables`
2. 添加以下环境变量：
   - `GLADOS_ACCOUNTS`: 包含账号信息的 JSON 数组，格式如下（**变量类型要选文本**）：
       ```
        [
          {"email": "your_email_1@example.com", "cookie": "your_cookie_1"},
          {"email": "your_email_2@example.com", "cookie": "your_cookie_2"}
        ]
       ```
    
   - `TGTOKEN`: Telegram Bot Token（可选）
   - `TGID`: Telegram Chat ID（可选）

#### 方式二：直接修改代码

在代码中直接修改 `accounts` 数组：

```
let accounts = [
    {email: "your_email@example.com", cookie: "your_cookie_here"}
];
```

### 3. 设置定时任务

1. 在 Worker 详情页面，点击 `Triggers`
2. 添加 Cron 触发器，例如 `0 0 * * *`（每天 UTC 时间 0:00 执行）

## 🔍 获取 Cookie

1. 登录 [GLaDOS 官网](https://glados.rocks/)
2. 打开浏览器开发者工具（F12）
3. 切换到 `Network` 标签页
4. 刷新页面，找到任意请求
5. 在请求头中找到 `Cookie` 字段并复制完整内容

## 📡 API 端点

Worker 提供以下 API 端点：

- `/checkin` - 执行签到并返回账号状态
- `/status` - 仅查询账号状态
- `/tg` - 执行签到并发送结果到 Telegram

## 📱 Telegram 通知设置

1. 创建 Telegram Bot，获取 Bot Token
   - 与 [@BotFather](https://t.me/BotFather) 对话创建
2. 获取 Chat ID
   - 可使用 [@userinfobot](https://t.me/userinfobot) 获取
3. 将 Bot Token 和 Chat ID 添加到环境变量

## ⚠️ 注意事项

- Cookie 包含敏感信息，请妥善保管
- 建议使用环境变量存储账号信息，而非硬编码在代码中
- 如遇签到失败，请检查 Cookie 是否过期

## 📄 许可证

MIT License

---

希望这个工具能帮助您自动完成 GLaDOS 的签到任务！如有问题或建议，欢迎提交 Issue。
