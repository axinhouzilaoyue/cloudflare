/**
 * 精简版 SSPanel 机场自动签到 (支持 Telegram 通知)
 */

// 配置机场信息
const AIRPORTS = [
  {
    name: "示例机场1",
    url: "https://example1.com", 
    email: "your-email@example.com",
    password: "your-password"
  }
];

// Telegram 配置变量
let botToken = ''; // 从环境变量 TGTOKEN 获取
let chatId = ''; // 从环境变量 TGID 获取

class AirportCheckin {
  constructor(config) {
    this.config = config;
    this.cookies = new Map();
  }

  async request(url, options = {}) {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...options.headers
    };

    if (this.cookies.size > 0) {
      headers['Cookie'] = Array.from(this.cookies.entries())
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
    }

    const response = await fetch(url, { ...options, headers });

    // 保存Cookie
    const setCookieHeaders = response.headers.getSetCookie ? response.headers.getSetCookie() : 
                            response.headers.get('Set-Cookie') ? [response.headers.get('Set-Cookie')] : [];
    
    setCookieHeaders.forEach(cookie => {
      const parts = cookie.split(';')[0].split('=');
      if (parts.length >= 2) {
        this.cookies.set(parts[0].trim(), parts.slice(1).join('=').trim());
      }
    });

    return response;
  }

  async login() {
    try {
      const loginUrl = `${this.config.url}/auth/login`;
      
      // 获取登录页面
      const loginPageResponse = await this.request(loginUrl);
      const loginPageText = await loginPageResponse.text();

      // 提取CSRF token
      let csrfToken = '';
      const tokenMatch = loginPageText.match(/name=["\']_token["\']\s+value=["\']([^"\']+)["\']/) ||
                        loginPageText.match(/csrf["\']?\s*:\s*["\']([^"\']+)["\']/) ||
                        loginPageText.match(/token["\']?\s*:\s*["\']([^"\']+)["\']/);
      if (tokenMatch) {
        csrfToken = tokenMatch[1];
      }

      // 构建登录数据
      const loginData = new URLSearchParams({
        email: this.config.email,
        passwd: this.config.password,
        remember_me: 'on'
      });
      if (csrfToken) loginData.append('_token', csrfToken);

      // 提交登录
      const response = await this.request(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': loginUrl,
          'Origin': this.config.url
        },
        body: loginData.toString()
      });

      const text = await response.text();

      // 检查JSON响应
      try {
        const json = JSON.parse(text);
        if (json.ret === 1 || json.code === 0 || json.success === true) {
          return { success: true, message: '登录成功' };
        } else {
          return { success: false, message: json.msg || json.message || '登录失败' };
        }
      } catch {
        // 检查HTML响应
        if (text.includes('用户中心') || text.includes('dashboard') || response.status >= 300) {
          return { success: true, message: '登录成功' };
        } else if (text.includes('密码错误') || text.includes('登录失败')) {
          return { success: false, message: '账号密码错误' };
        } else {
          return { success: text.length > 100, message: text.length > 100 ? '登录成功' : '登录失败' };
        }
      }
    } catch (error) {
      return { success: false, message: `登录异常: ${error.message}` };
    }
  }

  async checkin() {
    try {
      const response = await this.request(`${this.config.url}/user/checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      const text = await response.text();

      // 检查JSON响应
      try {
        const result = JSON.parse(text);
        return {
          success: result.ret === 1 || result.ret === 0 || result.code === 0,
          message: result.msg || result.message || '签到完成'
        };
      } catch {
        // 检查HTML响应
        if (text.includes('签到成功') || text.includes('获得了')) {
          return { success: true, message: '签到成功' };
        } else if (text.includes('已签到') || text.includes('已经签到')) {
          return { success: true, message: '今日已签到' };
        } else {
          return { success: false, message: '签到失败' };
        }
      }
    } catch (error) {
      return { success: false, message: `签到异常: ${error.message}` };
    }
  }

  async run() {
    const result = {
      airport: this.config.name,
      email: this.config.email,
      success: false,
      message: '',
      time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    };

    const loginResult = await this.login();
    if (!loginResult.success) {
      result.message = loginResult.message;
      return result;
    }

    const checkinResult = await this.checkin();
    result.success = checkinResult.success;
    result.message = checkinResult.message;

    return result;
  }
}

// 初始化环境变量
function initializeVariables(env) {
  botToken = env.TGTOKEN || '';
  chatId = env.TGID || '';
}

// 发送消息到 Telegram
async function sendTelegramMessage(results) {
  if (!botToken || !chatId) {
    console.log('Telegram 配置未设置，跳过通知');
    return { sent: false, error: 'Telegram 配置未设置' };
  }

  try {
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const formattedTime = beijingTime.toISOString().slice(0, 19).replace('T', ' ');

    let message = `<b>✈️ SSPanel 机场签到报告</b>\n`;
    message += `<i>${formattedTime}</i>\n\n`;

    // 添加签到结果
    let successCount = 0;
    let failureCount = 0;

    results.forEach(result => {
      const statusIcon = result.success ? '✅' : '❌';
      const statusText = result.success ? '成功' : '失败';
      
      message += `<b>${result.airport}</b>\n`;
      message += `${statusIcon} <code>${result.email}</code>\n`;
      message += `📝 ${result.message}\n`;
      message += `⏰ ${result.time}\n\n`;

      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    });

    // 添加统计信息
    message += `<b>📊 签到统计</b>\n`;
    message += `✅ 成功: ${successCount} 个账号\n`;
    message += `❌ 失败: ${failureCount} 个账号\n`;
    message += `🔢 总计: ${results.length} 个账号`;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; SSPanel-Checkin/1.0)'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      console.log('Telegram 消息发送成功');
      return { sent: true };
    } else {
      const errorData = await response.text();
      console.error('Telegram 消息发送失败:', errorData);
      return { sent: false, error: `发送失败: ${response.status}` };
    }
  } catch (error) {
    console.error('Telegram 通知异常:', error.message);
    return { sent: false, error: error.message };
  }
}

// 执行所有机场签到
async function handleRequest() {
  const results = [];
  for (const config of AIRPORTS) {
    try {
      const checkin = new AirportCheckin(config);
      const result = await checkin.run();
      results.push(result);
    } catch (error) {
      // 如果某个机场签到出错，记录错误但继续处理其他机场
      results.push({
        airport: config.name,
        email: config.email,
        success: false,
        message: `处理异常: ${error.message}`,
        time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      });
    }
  }
  return { success: true, timestamp: new Date().toISOString(), results };
}

export default {
  async fetch(request, env) {
    try {
      // 初始化环境变量
      initializeVariables(env);
      
      const url = new URL(request.url);
      
      // 路由处理
      switch (url.pathname) {
        case "/tg":
          // 检查 Telegram 配置
          if (!botToken || !chatId) {
            return new Response(JSON.stringify({
              success: false,
              error: "Telegram 配置未完成",
              message: "请在 Cloudflare Workers 环境变量中设置 TGTOKEN 和 TGID",
              help: {
                "TGTOKEN": "从 @BotFather 获取的 Bot Token",
                "TGID": "你的 Telegram Chat ID (可从 @userinfobot 获取)"
              }
            }, null, 2), {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          // 执行签到并发送 Telegram 通知
          const tgResult = await handleRequest();
          const telegramResult = await sendTelegramMessage(tgResult.results);
          
          return new Response(JSON.stringify({
            ...tgResult,
            telegram_sent: telegramResult.sent,
            telegram_error: telegramResult.error || null,
            message: telegramResult.sent 
              ? "签到完成，已发送 Telegram 通知" 
              : `签到完成，但 Telegram 通知发送失败: ${telegramResult.error}`
          }, null, 2), {
            status: telegramResult.sent ? 200 : 206, // 206 表示部分成功
            headers: { 'Content-Type': 'application/json' }
          });

        case "/status":
          // 仅显示配置状态
          return new Response(JSON.stringify({
            airports_configured: AIRPORTS.length,
            telegram_configured: !!(botToken && chatId),
            endpoints: [
              "/ - 显示帮助信息",
              "/checkin - 执行签到（不发送通知）", 
              "/tg - 执行签到并发送 Telegram 通知",
              "/status - 显示配置状态"
            ]
          }, null, 2), {
            headers: { 'Content-Type': 'application/json' }
          });

        case "/checkin":
          // 仅执行签到，不发送通知
          const checkinResult = await handleRequest();
          return new Response(JSON.stringify(checkinResult, null, 2), {
            headers: { 'Content-Type': 'application/json' }
          });

        default:
          // 默认帮助页面
          const helpMessage = `
SSPanel 机场自动签到服务

🔧 环境变量配置:
- TGTOKEN: Telegram Bot Token (可选)
- TGID: Telegram Chat ID (可选)

📡 可用端点:
- GET  /         - 显示此帮助信息
- POST /checkin  - 执行机场签到
- POST /tg       - 执行签到并发送 Telegram 通知  
- GET  /status   - 查看配置状态

📊 当前状态:
- 已配置机场: ${AIRPORTS.length} 个
- Telegram 通知: ${botToken && chatId ? '✅ 已配置' : '❌ 未配置'}

⏰ 支持 Cloudflare Workers 定时任务
          `;
          
          return new Response(helpMessage, {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
      }
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 定时任务处理函数
  async scheduled(event, env, ctx) {
    console.log('SSPanel 机场签到定时任务开始');
    try {
      // 初始化环境变量
      initializeVariables(env);
      
      // 执行签到
      const result = await handleRequest();
      
      // 尝试发送 Telegram 通知
      const telegramResult = await sendTelegramMessage(result.results);
      
      console.log('SSPanel 机场签到定时任务完成');
      return new Response(JSON.stringify({
        ...result,
        telegram_sent: telegramResult.sent,
        telegram_error: telegramResult.error || null,
        scheduled: true,
        message: telegramResult.sent 
          ? "定时任务完成，已发送 Telegram 通知"
          : `定时任务完成，Telegram 通知: ${telegramResult.error || '未配置'}`
      }));
    } catch (error) {
      console.error('定时任务失败:', error);
      
      // 即使出错也尝试发送错误通知（如果配置了 Telegram）
      if (botToken && chatId) {
        await sendTelegramMessage([{
          airport: "系统",
          email: "定时任务",
          success: false,
          message: `定时任务执行失败: ${error.message}`,
          time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        }]);
      }
      
      return new Response(JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }), { status: 500 });
    }
  }
};
