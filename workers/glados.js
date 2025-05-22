// GLaDOS 签到 Cloudflare Worker
// 参考 glados.py 实现，支持 Telegram 通知
// 支持多账号签到，使用 JSON 格式的环境变量

// 可以在这里直接设置账号信息，格式为 [{email: '邮箱', cookie: 'Cookie字符串'}, ...]
let accounts = [
    // 示例：直接在代码中配置账号
    // {email: 'example@gmail.com', cookie: 'your_cookie_here'}
];
let BotToken = ''; // Telegram Bot Token
let ChatID = ''; // Telegram Chat ID
let 签到结果列表 = [];
let 账号状态列表 = [];

export default {
    // HTTP 请求处理函数
    async fetch(request, env, ctx) {
        await initializeVariables(env);
        const url = new URL(request.url);

        if (url.pathname == "/tg") {
            // 修改 /tg 端点，先执行签到和状态查询，再发送通知
            await performAllCheckins();
            await checkAllAccountStatus();
            await sendMessage();
            return new Response("已执行签到并发送结果到 Telegram", {
                status: 200,
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
            });
        } else if (url.pathname == "/checkin") {
            await performAllCheckins();
            await checkAllAccountStatus();
            return new Response(签到结果列表.join("\n") + "\n\n" + 账号状态列表.join("\n"), {
                status: 200,
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
            });
        } else if (url.pathname == "/status") {
            await checkAllAccountStatus();
            return new Response(账号状态列表.join("\n"), {
                status: 200,
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
            });
        }

        return new Response("GLaDOS 多账号签到服务正在运行\n\n可用端点:\n/checkin - 执行签到并查询状态\n/status - 仅查询账号状态\n/tg - 执行签到并发送结果到 Telegram", {
            status: 200,
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
        });
    },

    // 定时任务处理函数
    async scheduled(controller, env, ctx) {
        console.log('GLaDOS 多账号签到定时任务开始');
        try {
            await initializeVariables(env);
            await performAllCheckins();
            await checkAllAccountStatus();
            await sendMessage();
            console.log('GLaDOS 多账号签到定时任务完成');
        } catch (error) {
            console.error('定时任务失败:', error);
            签到结果列表.push(`定时任务执行失败: ${error.message}`);
            await sendMessage();
        }
    },
};

// 初始化变量
async function initializeVariables(env) {
    // 保存代码中已配置的账号
    const hardcodedAccounts = [...accounts];

    // 重置列表
    accounts = [];
    签到结果列表 = [];
    账号状态列表 = [];

    // 设置 Telegram 信息
    BotToken = env.TGTOKEN || BotToken;
    ChatID = env.TGID || ChatID;

    // 1. 首先尝试从环境变量加载账号
    const accountsJson = env.GLADOS_ACCOUNTS || '[]';
    try {
        const parsedAccounts = JSON.parse(accountsJson);
        if (Array.isArray(parsedAccounts) && parsedAccounts.length > 0) {
            accounts = parsedAccounts.filter(acc => acc.email && acc.cookie);
            console.log(`从环境变量加载了 ${accounts.length} 个账号`);
        }
    } catch (error) {
        console.error('解析环境变量账号信息失败:', error);
    }

    // 2. 如果环境变量中没有配置任何账号，使用代码中硬编码的账号
    if (accounts.length === 0 && hardcodedAccounts.length > 0) {
        accounts = hardcodedAccounts.filter(acc => acc.email && acc.cookie);
        console.log(`使用代码中配置的 ${accounts.length} 个账号`);
    }

    if (accounts.length === 0) {
        console.warn('未配置任何账号信息，请在代码中或环境变量中设置账号');
    } else {
        console.log(`共加载 ${accounts.length} 个账号`);
    }
}

// 生成随机 User-Agent
function generateUserAgent() {
    const userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Linux; Android 10; zh-CN; SM-G9750) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.1 Safari/605.1.15",
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// 生成请求头
function generateHeaders(cookie) {
    return {
        "Accept": "application/json, text/plain, */*",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Authorization": "9876543210987654321098765432109-1234-567",
        "Content-Type": "application/json;charset=UTF-8",
        "Cookie": cookie,
        "Origin": "https://glados.rocks",
        "Sec-Ch-Ua": '"Not-A.Brand";v="99", "Chromium";v="124"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "User-Agent": generateUserAgent()
    };
}

// 翻译签到消息
function translateMessage(responseData) {
    // 参数验证
    if (!responseData || typeof responseData !== 'object') {
        return "无效的签到数据 ⚠️";
    }
    
    const rawMessage = responseData.message;
    const currentBalance = responseData.list && responseData.list[0] 
        ? Math.floor(parseFloat(responseData.list[0].balance))
        : '未知';
    
    if (rawMessage === "Please Try Tomorrow") {
        return `签到失败，请明天再试 🤖\n当前余额：${currentBalance}积分`;
    } else if (rawMessage && rawMessage.includes("Checkin! Got")) {
        const match = rawMessage.match(/Got (\d+) Points?/);
        const points = match ? match[1] : '未知';
        return `签到成功，获得${points}积分 🎉\n当前余额：${currentBalance}积分`;
    } else if (rawMessage === "Checkin Repeats! Please Try Tomorrow") {
        return `重复签到，请明天再试 🔁\n当前余额：${currentBalance}积分`;
    } else {
        return `未知的签到结果: ${rawMessage} ❓\n当前余额：${currentBalance}积分`;
    }
}

// 格式化天数
function formatDays(daysStr) {
    const days = parseFloat(daysStr);
    if (Number.isInteger(days)) {
        return days.toString();
    }
    return days.toFixed(8).replace(/\.?0+$/, '');
}

// 发送消息到 Telegram
async function sendMessage() {
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const formattedTime = beijingTime.toISOString().slice(0, 19).replace('T', ' ');

    let message = `<b>📊 GLaDOS 签到报告</b>\n`;
    message += `<i>${formattedTime}</i>\n\n`;

    if (签到结果列表.length > 0) {
        message += `<b>📝 签到结果</b>\n${签到结果列表.join("\n")}\n\n`;
    }

    if (账号状态列表.length > 0) {
        message += `<b>📈 账号状态</b>\n${账号状态列表.join("\n")}\n\n`;
    }

    message += `<code>✅ 共完成 ${accounts.length} 个账号的签到任务</code>`;

    console.log(message);

    if (BotToken !== '' && ChatID !== '') {
        const url = `https://api.telegram.org/bot${BotToken}/sendMessage?chat_id=${ChatID}&parse_mode=HTML&text=${encodeURIComponent(message)}`;
        return fetch(url, {
            method: 'get',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;',
                'Accept-Encoding': 'gzip, deflate, br',
                'User-Agent': 'Mozilla/5.0 Chrome/90.0.4430.72'
            }
        });
    }
}

// 执行所有账号的签到
async function performAllCheckins() {
    签到结果列表 = [];

    if (accounts.length === 0) {
        签到结果列表.push("⚠️ 未配置任何账号信息");
        return;
    }

    for (const account of accounts) {
        try {
            const result = await performCheckin(account.email, account.cookie);
            签到结果列表.push(result);
        } catch (error) {
            console.error(`账号 ${account.email} 签到错误:`, error);
            签到结果列表.push(`<b>${account.email}</b>: 签到过程发生错误: ${error.message} ❌`);
        }
    }

    return 签到结果列表;
}

// 检查所有账号的状态
async function checkAllAccountStatus() {
    账号状态列表 = [];

    if (accounts.length === 0) {
        账号状态列表.push("⚠️ 未配置任何账号信息");
        return;
    }

    for (const account of accounts) {
        try {
            const result = await checkAccountStatus(account.email, account.cookie);
            账号状态列表.push(result);
        } catch (error) {
            console.error(`账号 ${account.email} 状态查询错误:`, error);
            账号状态列表.push(`<b>${account.email}</b>: 获取状态失败 - ${error.message} ❌`);
        }
    }

    return 账号状态列表;
}

// 执行单个账号签到
async function performCheckin(email, cookie) {
    try {
        if (!cookie) {
            throw new Error('Cookie 未设置');
        }

        const url = "https://glados.rocks/api/user/checkin";
        const headers = generateHeaders(cookie);
        const data = { token: "glados.one" };

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            throw new Error(`签到请求失败: ${response.status} ${response.statusText}`);
        }

        const responseData = await response.json();
        const translatedMessage = translateMessage(responseData);

        const result = `<b>${email}</b>: ${translatedMessage}`;
        console.log(`签到结果: ${result}`);

        return result;
    } catch (error) {
        console.error('签到错误:', error);
        return `<b>${email}</b>: 签到过程发生错误: ${error.message} ❌`;
    }
}

// 检查单个账号状态
async function checkAccountStatus(email, cookie) {
    try {
        if (!cookie) {
            throw new Error('Cookie 未设置');
        }

        const url = "https://glados.rocks/api/user/status";
        const headers = generateHeaders(cookie);

        const response = await fetch(url, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            throw new Error(`获取状态请求失败: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.data || !data.data.leftDays) {
            throw new Error('响应数据格式不正确');
        }

        const leftDays = formatDays(data.data.leftDays);
        const result = `<b>${email}</b>: 剩余 <b><code>${leftDays}</code></b> 天`;
        console.log(`账号状态: ${result}`);

        return result;
    } catch (error) {
        console.error('获取账号状态错误:', error);
        return `<b>${email}</b>: 获取状态失败 - ${error.message} ❌`;
    }
}
