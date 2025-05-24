// GLaDOS 签到 Cloudflare Worker
// 支持多账号签到，使用 JSON 格式的环境变量，支持 Telegram 通知

// 常量定义
const API_BASE_URL = "https://glados.rocks/api";
const API_ENDPOINTS = {
    CHECKIN: "/user/checkin",
    STATUS: "/user/status"
};
const CONTENT_TYPE_TEXT = { 'Content-Type': 'text/plain;charset=UTF-8' };
const CONTENT_TYPE_HTML = { 'Content-Type': 'text/html;charset=UTF-8' };

// 全局变量
let accounts = [
    // 示例：直接在代码中配置账号
    // {email: 'example@gmail.com', cookie: 'your_cookie_here'}
];
let botToken = ''; // Telegram Bot Token
let chatId = ''; // Telegram Chat ID
let checkinResults = [];
let accountStatus = [];
let pointsHistory = [];
let workerUrl = '';

export default {
    // HTTP 请求处理函数
    async fetch(request, env, ctx) {
        await initializeVariables(env);
        const url = new URL(request.url);

        // 路由处理
        switch (url.pathname) {
            case "/tg":
                await performAllCheckins();
                await checkAllAccountStatus();
                await sendTelegramMessage(request);
                return createResponse("已执行签到并发送结果到 Telegram");

            case "/checkin":
                await performAllCheckins();
                await checkAllAccountStatus();
                return createResponse(checkinResults.join("\n") + "\n\n" + accountStatus.join("\n"));

            case "/status":
                await checkAllAccountStatus();
                return createResponse(accountStatus.join("\n"));

            case "/checkinChart":
                await fetchPointsHistory();
                return generateChartResponse();

            default:
                return createResponse(
                    "GLaDOS 多账号签到服务正在运行\n\n可用端点:\n" +
                    "/checkin - 执行签到并查询状态\n" +
                    "/status - 仅查询账号状态\n" +
                    "/tg - 执行签到并发送结果到 Telegram\n" +
                    "/checkinChart - 查看积分历史图表"
                );
        }
    },

    // 定时任务处理函数
    async scheduled(controller, env, ctx) {
        console.log('GLaDOS 多账号签到定时任务开始');
        try {
            await initializeVariables(env);
            await performAllCheckins();
            await checkAllAccountStatus();
            await sendTelegramMessage();
            console.log('GLaDOS 多账号签到定时任务完成');
        } catch (error) {
            console.error('定时任务失败:', error);
            checkinResults.push(`定时任务执行失败: ${error.message}`);
            await sendTelegramMessage();
        }
    },
};

// 创建统一的响应对象
function createResponse(content, headers = CONTENT_TYPE_TEXT, status = 200) {
    return new Response(content, { status, headers });
}

// 初始化变量
async function initializeVariables(env) {
    // 保存代码中已配置的账号
    const hardcodedAccounts = [...accounts];

    // 重置列表
    accounts = [];
    checkinResults = [];
    accountStatus = [];
    pointsHistory = [];

    // 设置 Telegram 信息
    botToken = env.TGTOKEN || botToken;
    chatId = env.TGID || chatId;
    workerUrl = env.WORKER_URL || workerUrl;

    // 尝试从环境变量加载账号
    try {
        const accountsJson = env.GLADOS_ACCOUNTS || '[]';
        const parsedAccounts = JSON.parse(accountsJson);

        if (Array.isArray(parsedAccounts) && parsedAccounts.length > 0) {
            accounts = parsedAccounts.filter(acc => acc.email && acc.cookie);
            console.log(`从环境变量加载了 ${accounts.length} 个账号`);
        }
    } catch (error) {
        console.error('解析环境变量账号信息失败:', error);
    }

    // 如果环境变量中没有配置任何账号，使用代码中硬编码的账号
    if (accounts.length === 0 && hardcodedAccounts.length > 0) {
        accounts = hardcodedAccounts.filter(acc => acc.email && acc.cookie);
        console.log(`使用代码中配置的 ${accounts.length} 个账号`);
    }

    if (accounts.length === 0) {
        console.warn('未配置任何账号信息，请在代码中或环境变量中设置账号');
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

// 执行API请求
async function makeApiRequest(endpoint, method, cookie, data = null) {
    if (!cookie) {
        throw new Error('Cookie 未设置');
    }

    const url = API_BASE_URL + endpoint;
    const headers = generateHeaders(cookie);
    const options = {
        method,
        headers
    };

    if (data) {
        options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
        throw new Error(`请求失败: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

// 转换签到消息
function translateMessage(responseData) {
    if (!responseData || typeof responseData !== 'object') {
        return "无效的签到数据 ⚠️";
    }

    const rawMessage = responseData.message;
    const currentBalance = responseData.list && responseData.list[0] ?
        Math.floor(parseFloat(responseData.list[0].balance)) : '未知';

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

// 获取Worker的URL
function getWorkerUrl(request) {
    if (!request) return '';
    try {
        const url = new URL(request.url);
        return `${url.protocol}//${url.host}`;
    } catch (error) {
        console.error('获取Worker URL失败:', error);
        return '';
    }
}

// 发送消息到 Telegram
async function sendTelegramMessage(request) {
    if (botToken === '' || chatId === '') {
        return;
    }

    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const formattedTime = beijingTime.toISOString().slice(0, 19).replace('T', ' ');

    let message = `<b>📊 GLaDOS 签到报告</b>\n`;
    message += `<i>${formattedTime}</i>\n\n`;

    if (checkinResults.length > 0) {
        message += `<b>📝 签到结果</b>\n${checkinResults.join("\n")}\n\n`;
    }

    if (accountStatus.length > 0) {
        message += `<b>📈 账号状态</b>\n${accountStatus.join("\n")}\n\n`;
    }

    message += `<code>✅ 共完成 ${accounts.length} 个账号的签到任务</code>`;

    // 添加图表链接，仅当request参数存在时
    // 获取 Worker URL
    const baseUrl = request ? getWorkerUrl(request) : workerUrl;
    const chartUrl = baseUrl + "/checkinChart";
    message += `\n\n<b>📊 <a href="${chartUrl}">点击查看积分历史图表</a></b>`;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${chatId}&parse_mode=HTML&text=${encodeURIComponent(message)}`;
    return fetch(url, {
        method: 'get',
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;',
            'Accept-Encoding': 'gzip, deflate, br',
            'User-Agent': 'Mozilla/5.0 Chrome/90.0.4430.72'
        }
    });
}

// 执行所有账号的签到
async function performAllCheckins() {
    checkinResults = [];

    if (accounts.length === 0) {
        checkinResults.push("⚠️ 未配置任何账号信息");
        return;
    }

    for (const account of accounts) {
        try {
            const result = await performCheckin(account.email, account.cookie);
            checkinResults.push(result);
        } catch (error) {
            console.error(`账号 ${account.email} 签到错误:`, error);
            checkinResults.push(`<b>${account.email}</b>: 签到过程发生错误: ${error.message} ❌`);
        }
    }

    return checkinResults;
}

// 检查所有账号的状态
async function checkAllAccountStatus() {
    accountStatus = [];

    if (accounts.length === 0) {
        accountStatus.push("⚠️ 未配置任何账号信息");
        return;
    }

    for (const account of accounts) {
        try {
            const result = await checkAccountStatus(account.email, account.cookie);
            accountStatus.push(result);
        } catch (error) {
            console.error(`账号 ${account.email} 状态查询错误:`, error);
            accountStatus.push(`<b>${account.email}</b>: 获取状态失败 - ${error.message} ❌`);
        }
    }

    return accountStatus;
}

// 执行单个账号签到
async function performCheckin(email, cookie) {
    try {
        const data = { token: "glados.one" };
        const responseData = await makeApiRequest(API_ENDPOINTS.CHECKIN, 'POST', cookie, data);
        const translatedMessage = translateMessage(responseData);

        const result = `<b>${email}</b>: ${translatedMessage}`;
        return result;
    } catch (error) {
        throw new Error(`签到失败: ${error.message}`);
    }
}

// 检查单个账号状态
async function checkAccountStatus(email, cookie) {
    try {
        const data = await makeApiRequest(API_ENDPOINTS.STATUS, 'GET', cookie);

        if (!data.data || !data.data.leftDays) {
            throw new Error('响应数据格式不正确');
        }

        const leftDays = formatDays(data.data.leftDays);
        return `<b>${email}</b>: 剩余 <b><code>${leftDays}</code></b> 天`;
    } catch (error) {
        throw new Error(`获取状态失败: ${error.message}`);
    }
}

// 获取积分历史数据
async function fetchPointsHistory() {
    pointsHistory = [];

    if (accounts.length === 0) {
        return;
    }

    for (const account of accounts) {
        try {
            // 获取积分历史
            const data = { token: "glados.one" };
            const responseData = await makeApiRequest(API_ENDPOINTS.CHECKIN, 'POST', account.cookie, data);

            // 获取账号状态（剩余天数）
            const statusData = await makeApiRequest(API_ENDPOINTS.STATUS, 'GET', account.cookie);
            const leftDays = statusData.data && statusData.data.leftDays ? formatDays(statusData.data.leftDays) : "未知";

            if (responseData.code === 1 && Array.isArray(responseData.list)) {
                // 处理积分历史数据
                const accountData = {
                    email: account.email,
                    leftDays: leftDays, // 添加剩余天数信息
                    history: responseData.list.map(item => ({
                            time: new Date(parseInt(item.time)),
                            balance: parseFloat(item.balance),
                            change: parseFloat(item.change),
                            business: item.business
                        })).sort((a, b) => a.time - b.time) // 按时间排序
                };
                pointsHistory.push(accountData);
            }
        } catch (error) {
            console.error(`获取账号 ${account.email} 积分历史错误:`, error);
        }
    }
}

// 生成图表响应
function generateChartResponse() {
    // 如果没有数据，返回提示信息
    if (pointsHistory.length === 0) {
        return createResponse("未获取到任何积分历史数据，请确保账号配置正确。");
    }

    // 生成HTML页面，包含Chart.js图表
    const html = generateChartHtml();
    return new Response(html, {
        status: 200,
        headers: CONTENT_TYPE_HTML
    });
}

// 生成图表HTML
function generateChartHtml() {
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GLaDOS 积分历史图表</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@2.1.0/dist/chartjs-plugin-annotation.min.js"></script>
    <style>
        :root {
            --primary-color: #007AFF;
            --secondary-color: #5AC8FA;
            --success-color: #34C759;
            --danger-color: #FF3B30;
            --warning-color: #FF9500;
            --text-color: #1D1D1F;
            --text-secondary: #86868B;
            --bg-color: #F5F5F7;
            --card-bg: #FFFFFF;
            --border-radius: 12px;
            --shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
            --transition: all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1);
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --primary-color: #0A84FF;
                --secondary-color: #64D2FF;
                --success-color: #30D158;
                --danger-color: #FF453A;
                --warning-color: #FF9F0A;
                --text-color: #F5F5F7;
                --text-secondary: #86868B;
                --bg-color: #1D1D1F;
                --card-bg: #2C2C2E;
                --shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
            }
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Icons', 'Helvetica Neue', Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 16px;
            background-color: var(--bg-color);
            color: var(--text-color);
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }

            .container {
            width: 100%;
            max-width: 1000px;
            margin: 0 auto;
            padding: 24px;
            }

            h1 {
            color: var(--text-color);
            text-align: center;
            margin-bottom: 32px;
            font-size: 28px;
            font-weight: 600;
            letter-spacing: -0.5px;
            }

        .controls {
            display: flex;
            justify-content: center;
            margin-bottom: 32px;
            gap: 12px;
            }

        .btn {
            background-color: var(--card-bg);
            color: var(--primary-color);
            border: 1px solid rgba(0, 0, 0, 0.1);
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: var(--transition);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }

        .btn svg {
            width: 14px;
            height: 14px;
        }

        .btn:hover {
            background-color: rgba(0, 122, 255, 0.1);
            transform: translateY(-1px);
        }

        .btn:active {
            transform: translateY(0);
            background-color: rgba(0, 122, 255, 0.2);
        }

            .chart-container {
            position: relative;
            height: 300px;
            margin-bottom: 32px;
            border-radius: var(--border-radius);
            background-color: var(--card-bg);
            padding: 16px;
            box-shadow: var(--shadow);
            transition: var(--transition);
            }

        .chart-container:hover {
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
            transform: translateY(-2px);
            }

        .account-info {
            margin-top: 24px;
            border-radius: var(--border-radius);
            background-color: var(--card-bg);
            box-shadow: var(--shadow);
            overflow: hidden;
            transition: var(--transition);
            }

        .account-info:hover {
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
            transform: translateY(-2px);
            }

        .account-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
            padding: 16px 20px;
            border-bottom: 1px solid rgba(0, 0, 0, 0.05);
            transition: var(--transition);
        }

        .account-header:hover {
            background-color: rgba(0, 0, 0, 0.02);
        }

        .account-title {
            font-weight: 500;
            color: var(--text-color);
            font-size: 16px;
            display: flex;
            align-items: center;
        }

        .days-remaining {
            font-size: 16px;
            font-weight: 600;
            color: var(--primary-color);
            background-color: rgba(0, 122, 255, 0.1);
            padding: 6px 12px;
            border-radius: 8px;
            display: inline-flex;
            align-items: center;
            transition: var(--transition);
        }

        .days-remaining::before {
            content: "⏱️";
            margin-right: 6px;
            font-size: 14px;
        }

        .days-remaining:hover {
            background-color: rgba(0, 122, 255, 0.2);
            transform: translateY(-1px);
        }

        .account-content {
            overflow: hidden;
            transition: max-height 0.5s cubic-bezier(0.25, 0.1, 0.25, 1);
            max-height: 2000px;
            padding: 0 20px 20px;
        }

        .account-content.collapsed {
            max-height: 0;
            padding-top: 0;
            padding-bottom: 0;
        }

        .toggle-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            margin-right: 8px;
            color: var(--primary-color);
            transition: transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1);
        }

        .collapsed .toggle-icon {
            transform: rotate(-90deg);
        }

        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
            gap: 16px;
            margin-top: 20px;
            margin-bottom: 20px;
        }

        .stat-card {
            background-color: rgba(0, 0, 0, 0.02);
            padding: 16px;
            border-radius: 10px;
            transition: var(--transition);
        }

        .stat-card:hover {
            background-color: rgba(0, 0, 0, 0.04);
            transform: translateY(-2px);
        }

        .stat-title {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 8px;
        }

        .stat-value {
            font-size: 20px;
            font-weight: 600;
            color: var(--text-color);
            letter-spacing: -0.5px;
        }

        .stat-subtitle {
            font-size: 14px;
            font-weight: 500;
            color: var(--text-secondary);
            margin-left: 4px;
        }

        .positive {
            color: var(--success-color);
        }

        .negative {
            color: var(--danger-color);
        }

        @media (max-width: 768px) {
            body {
                padding: 12px;
            }

            .container {
                padding: 16px;
            }

            h1 {
                font-size: 24px;
                margin-bottom: 24px;
            }

            .chart-container {
                height: 250px;
                padding: 12px;
            }

            .stats {
                grid-template-columns: repeat(2, 1fr);
                gap: 12px;
            }

            .stat-card {
                padding: 12px;
            }

            .stat-value {
                font-size: 18px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>GLaDOS 积分历史</h1>

        <div class="controls">
            <button class="btn" id="expandAll">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 12H21M12 3V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                全部展开
            </button>
            <button class="btn" id="collapseAll">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 12H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                全部折叠
            </button>
                        </div>
            ${pointsHistory.map((accountData, index) => {
            // 提取数据用于图表
                const dates = accountData.history.map(item => item.time.toLocaleDateString());
                const balances = accountData.history.map(item => item.balance);
            // 计算统计信息
            const currentBalance = balances.length > 0 ? balances[balances.length - 1] : 0;
            const changes = accountData.history.map(item => item.change);
            const totalEarned = changes.filter(change => change > 0).reduce((sum, change) => sum + change, 0);
            const totalSpent = Math.abs(changes.filter(change => change < 0).reduce((sum, change) => sum + change, 0));

            // 计算签到次数
            const checkinCount = accountData.history.filter(item =>
                item.business && item.business.includes('checkin')
            ).length;

            // 计算兑换次数
            const collectCount = accountData.history.filter(item =>
                item.business && item.business.includes('collect')
            ).length;

            return `
            <div class="account-info" data-account-id="${index}">
                <div class="account-header" onclick="toggleAccount(${index})">
                    <div class="account-title">
                        <span class="toggle-icon">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M6 9.5L11 4.5L10.1 3.6L6 7.7L1.9 3.6L1 4.5L6 9.5Z" fill="currentColor"/>
                            </svg>
                        </span>
                        ${accountData.email}
                </div>
                    <div class="days-remaining">剩余 ${accountData.leftDays} 天</div>
                        </div>

                <div class="account-content" id="account-content-${index}">
                    <div class="stats">
                        <div class="stat-card">
                            <div class="stat-title">当前积分</div>
                            <div class="stat-value">${currentBalance.toFixed(2)}</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-title">剩余天数</div>
                            <div class="stat-value">${accountData.leftDays}</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-title">签到次数</div>
                            <div class="stat-value">${checkinCount}</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-title">累计获得</div>
                            <div class="stat-value positive">+${totalEarned.toFixed(2)}</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-title">累计消费 / 兑换次数</div>
                            <div class="stat-value">
                                <span class="negative">-${totalSpent.toFixed(2)}</span>
                                <span class="stat-subtitle"> / ${collectCount}次</span>
                            </div>
                        </div>
                    </div>
                    <div class="chart-container">
                        <canvas id="chart${index}"></canvas>
                    </div>
                </div>
            </div>
  `;
            }).join('')}
    </div>

    <script>
        // 初始化图表
        document.addEventListener('DOMContentLoaded', function() {
            // 设置Chart.js全局默认值
            Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Icons", "Helvetica Neue", Helvetica, Arial, sans-serif';
            Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim();
            // 为每个账号创建图表
            ${pointsHistory.map((accountData, index) => {
                const dates = accountData.history.map(item => item.time.toLocaleDateString());
                const balances = accountData.history.map(item => item.balance);
                return `
                const ctx${index} = document.getElementById('chart${index}');
                if (ctx${index}) {
                    new Chart(ctx${index}, {
                        type: 'line',
                        data: {
                            labels: ${JSON.stringify(dates)},
                            datasets: [{
                                label: '积分余额',
                                data: ${JSON.stringify(balances)},
                                backgroundColor: 'rgba(0, 122, 255, 0.1)',
                                borderColor: 'rgba(0, 122, 255, 0.8)',
                                borderWidth: 2,
                                pointRadius: 4,
                                pointBackgroundColor: 'rgba(0, 122, 255, 1)',
                                pointBorderColor: '#FFFFFF',
                                pointBorderWidth: 2,
                                pointHoverRadius: 6,
                                pointHoverBackgroundColor: 'rgba(0, 122, 255, 1)',
                                pointHoverBorderColor: '#FFFFFF',
                                pointHoverBorderWidth: 2,
                                tension: 0.4,
                                fill: true
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                title: {
                                    display: false
                                },
                                legend: {
                                    display: false
                                },
                                tooltip: {
                                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                    titleFont: {
                                        size: 13,
                                        weight: '500'
                                    },
                                    bodyFont: {
                                        size: 14,
                                        weight: '600'
                                    },
                                    padding: 12,
                                    cornerRadius: 8,
                                    callbacks: {
                                        label: function(context) {
                                            return '积分: ' + context.parsed.y.toFixed(2);
                                        }
                                    }
                                },
                                annotation: {
                                    annotations: {
                                        line100: {
                                            type: 'line',
                                            yMin: 100,
                                            yMax: 100,
                                            borderColor: 'rgba(255, 59, 48, 0.7)',
                                            borderWidth: 1.5,
                                            borderDash: [5, 5],
                                            label: {
                                                display: true,
                                                content: '100积分',
                                                position: 'start',
                                                backgroundColor: 'rgba(255, 59, 48, 0.7)',
                                                color: '#FFFFFF',
                                                font: {
                                                    size: 12,
                                                    weight: '500'
                                                },
                                                padding: {
                                                    top: 4,
                                                    bottom: 4,
                                                    left: 8,
                                                    right: 8
                                                },
                                                borderRadius: 4
                                            }
                                        }
                                    }
                                }
                            },
                            scales: {
                                y: {
                                    beginAtZero: false,
                                    grid: {
                                        color: 'rgba(0, 0, 0, 0.05)',
                                        drawBorder: false
                                    },
                                    ticks: {
                                        padding: 8,
                                        font: {
                                            size: 11
                                        }
                                    },
                                    border: {
                                        display: false
                                    }
                                },
                                x: {
                                    grid: {
                                        display: false,
                                        drawBorder: false
                                    },
                                    ticks: {
                                        maxRotation: 45,
                                        minRotation: 45,
                                        padding: 8,
                                        font: {
                                            size: 11
                                        }
                                    },
                                    border: {
                                        display: false
                                    }
                                }
                            },
                            interaction: {
                                mode: 'index',
                                intersect: false
                            },
                            elements: {
                                line: {
                                    tension: 0.3
                                }
                            },
                            layout: {
                                padding: {
                                    top: 10,
                                    right: 16,
                                    bottom: 10,
                                    left: 16
                                }
                            }
                        }
            });
                }
  `;
            }).join('')}

            // 默认展开第一个账号，折叠其他账号
            const accounts = document.querySelectorAll('.account-info');
            accounts.forEach((account, idx) => {
                if (idx > 0) {
                    toggleAccount(idx);
}
            });
        });

        // 切换账号展开/折叠状态
        function toggleAccount(index) {
            const content = document.getElementById('account-content-' + index);
            content.classList.toggle('collapsed');

            const accountInfo = document.querySelector('[data-account-id="' + index + '"]');
            const toggleIcon = accountInfo.querySelector('.toggle-icon svg');

            if (content.classList.contains('collapsed')) {
                toggleIcon.style.transform = 'rotate(-90deg)';
            } else {
                toggleIcon.style.transform = 'rotate(0deg)';
            }
        }

        // 全部展开按钮
        document.getElementById('expandAll').addEventListener('click', function() {
            const contents = document.querySelectorAll('.account-content');
            contents.forEach((content, index) => {
                content.classList.remove('collapsed');
                const accountInfo = document.querySelector('[data-account-id="' + index + '"]');
                const toggleIcon = accountInfo.querySelector('.toggle-icon svg');
                toggleIcon.style.transform = 'rotate(0deg)';
            });
        });

        // 全部折叠按钮
        document.getElementById('collapseAll').addEventListener('click', function() {
            const contents = document.querySelectorAll('.account-content');
            contents.forEach((content, index) => {
                content.classList.add('collapsed');
                const accountInfo = document.querySelector('[data-account-id="' + index + '"]');
                const toggleIcon = accountInfo.querySelector('.toggle-icon svg');
                toggleIcon.style.transform = 'rotate(-90deg)';
            });
        });

        // 检测系统深色/浅色模式变化
        if (window.matchMedia) {
            const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
            colorSchemeQuery.addEventListener('change', () => {
                location.reload(); // 重新加载页面以应用新的颜色方案
            });
        }
    </script>
</body>
</html>
  `;
}
