# SSPanel 机场自动签到脚本

基于 Cloudflare Workers 的 SSPanel 机场多账号自动签到工具，支持 Telegram 通知。

## 功能特性

- 支持多个机场账号批量签到
- 自动处理登录和 CSRF Token
- 支持 Telegram Bot 消息通知
- 定时任务和手动触发
- 详细的签到结果统计

## 配置

### 1. 机场账号配置

修改代码中的 `AIRPORTS` 数组：

```javascript
const AIRPORTS = [
  {
    name: "机场名称",
    url: "https://example.com", 
    email: "your-email@example.com",
    password: "your-password"
  }
];
```

### 2. Telegram 通知配置（可选）

在 Cloudflare Workers 中设置环境变量：

| 变量名 | 说明 | 获取方式 |
|--------|------|----------|
| `TGTOKEN` | Telegram Bot Token | 联系 @BotFather 创建 Bot |
| `TGID` | Telegram Chat ID | 联系 @userinfobot 获取 |

## API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/` | GET | 显示帮助信息 |
| `/checkin` | POST | 执行签到（无通知） |
| `/tg` | POST | 执行签到并发送 Telegram 通知 |
| `/status` | GET | 查看配置状态 |

## 部署

1. 在 [Cloudflare Workers](https://workers.cloudflare.com/) 创建新的 Worker
2. 复制[sspanel.js](https://raw.githubusercontent.com/axinhouzilaoyue/cloudflare/refs/heads/main/workers/sspanel.js)代码到编辑器：
3. 修改 `AIRPORTS` 配置
4. 设置环境变量（可选）
5. 部署并测试

## 定时任务

在 Workers 控制台的"触发器"页面添加 Cron 触发器：

```
0 9 * * *    # 每天上午 9 点执行
```

## 使用示例

### 手动签到
```bash
curl -X POST https://your-worker.workers.dev/checkin
```

### 带通知签到
```bash
curl -X POST https://your-worker.workers.dev/tg
```

### 查看状态
```bash
curl https://your-worker.workers.dev/status
```

## 响应格式

### 成功响应
```json
{
  "success": true,
  "timestamp": "2024-06-10T01:00:00.000Z",
  "telegram_sent": true,
  "message": "签到完成，已发送 Telegram 通知",
  "results": [
    {
      "airport": "示例机场",
      "email": "user@example.com", 
      "success": true,
      "message": "签到成功",
      "time": "2024-06-10 09:00:00"
    }
  ]
}
```

### 配置错误响应
```json
{
  "success": false,
  "error": "Telegram 配置未完成",
  "help": {
    "TGTOKEN": "从 @BotFather 获取的 Bot Token",
    "TGID": "你的 Telegram Chat ID"
  }
}
```

## 注意事项

- 定时任务会自动发送 Telegram 通知（如已配置）
- 单个机场签到失败不影响其他机场
- 支持多种 SSPanel 版本的响应格式
- 建议使用环境变量存储敏感信息
