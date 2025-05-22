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
    if (request) {
        const chartUrl = getWorkerUrl(request) + "/checkinChart";
        message += `\n\n<b>📊 <a href="${chartUrl}">点击查看积分历史图表</a></b>`;
    }

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
            const data = { token: "glados.one" };
            const responseData = await makeApiRequest(API_ENDPOINTS.CHECKIN, 'POST', account.cookie, data);

            if (responseData.code === 1 && Array.isArray(responseData.list)) {
                // 处理积分历史数据
                const accountData = {
                    email: account.email,
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
    <style>
        :root {
            --primary-color: #3498db;
            --success-color: #27ae60;
            --danger-color: #e74c3c;
            --text-color: #333;
            --bg-color: #f5f5f5;
            --card-bg: white;
            --border-radius: 8px;
        }

        * {
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
            margin: 0;
            padding: 10px;
            background-color: var(--bg-color);
            color: var(--text-color);
            line-height: 1.6;
        }

        .container {
            width: 100%;
            max-width: 1200px;
            margin: 0 auto;
            background-color: var(--card-bg);
            border-radius: var(--border-radius);
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            padding: 15px;
        }

        h1 {
            color: var(--text-color);
            text-align: center;
            margin-bottom: 20px;
            font-size: 1.8rem;
        }

        .controls {
            display: flex;
            justify-content: center;
            margin-bottom: 20px;
            flex-wrap: wrap;
            gap: 10px;
        }

        .btn {
            background-color: var(--primary-color);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.2s;
        }

        .btn:hover {
            background-color: #2980b9;
        }

        .chart-container {
            position: relative;
            height: 300px;
            margin-bottom: 20px;
        }

        .account-info {
            margin-top: 20px;
            padding: 15px;
            background-color: #f9f9f9;
            border-radius: var(--border-radius);
            transition: all 0.3s ease;
        }

        .account-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
            padding-bottom: 5px;
            border-bottom: 1px solid #ddd;
        }

        .account-title {
            font-weight: bold;
            color: var(--text-color);
            font-size: 1.1rem;
            display: flex;
            align-items: center;
        }

        .account-content {
            overflow: hidden;
            transition: max-height 0.3s ease;
            max-height: 2000px;
        }

        .account-content.collapsed {
            max-height: 0;
        }

        .toggle-icon {
            transition: transform 0.3s ease;
            margin-right: 8px;
        }

        .collapsed .toggle-icon {
            transform: rotate(-90deg);
        }

        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
            gap: 10px;
            margin-top: 15px;
        }

        .stat-card {
            background-color: var(--card-bg);
            padding: 12px;
            border-radius: 5px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }

        .stat-title {
            font-size: 13px;
            color: #666;
        }

        .stat-value {
            font-size: 18px;
            font-weight: bold;
            margin-top: 5px;
            color: #2c3e50;
        }

        .positive {
            color: var(--success-color);
        }

        .negative {
            color: var(--danger-color);
        }

        @media (max-width: 768px) {
            body {
                padding: 5px;
            }

            .container {
                padding: 10px;
            }

            h1 {
                font-size: 1.5rem;
                margin-bottom: 15px;
            }

            .chart-container {
                height: 250px;
            }

            .stats {
                grid-template-columns: repeat(2, 1fr);
            }

            .stat-card {
                padding: 10px;
            }

            .stat-value {
                font-size: 16px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>GLaDOS 积分历史图表</h1>

        <div class="controls">
            <button class="btn" id="expandAll">全部展开</button>
            <button class="btn" id="collapseAll">全部折叠</button>
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
                        <span class="toggle-icon">▼</span>
                        账号: ${accountData.email}
                    </div>
                    <div class="stat-value">${currentBalance.toFixed(2)} 积分</div>
                </div>

                <div class="account-content" id="account-content-${index}">
                    <div class="stats">
                        <div class="stat-card">
                            <div class="stat-title">当前积分</div>
                            <div class="stat-value">${currentBalance.toFixed(2)}</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-title">累计获得积分</div>
                            <div class="stat-value positive">+${totalEarned.toFixed(2)}</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-title">累计消费积分</div>
                            <div class="stat-value negative">-${totalSpent.toFixed(2)}</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-title">签到次数</div>
                            <div class="stat-value">${checkinCount}</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-title">兑换次数</div>
                            <div class="stat-value">${collectCount}</div>
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
                                backgroundColor: 'rgba(54, 162, 235, 0.2)',
                                borderColor: 'rgba(54, 162, 235, 1)',
                                borderWidth: 2,
                                pointRadius: 3,
                                pointBackgroundColor: 'rgba(54, 162, 235, 1)',
                                tension: 0.1
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                title: {
                                    display: true,
                                    text: '积分余额变化趋势',
                                    font: {
                                        size: 16
                                    }
                                },
                                tooltip: {
                                    callbacks: {
                                        label: function(context) {
                                            return '积分: ' + context.parsed.y.toFixed(2);
                                        }
                                    }
                                }
                            },
                            scales: {
                                y: {
                                    beginAtZero: false,
                                    title: {
                                        display: true,
                                        text: '积分'
                                    }
                                },
                                x: {
                                    title: {
                                        display: true,
                                        text: '日期'
                                    },
                                    ticks: {
                                        maxRotation: 45,
                                        minRotation: 45
                                    }
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
            const toggleIcon = accountInfo.querySelector('.toggle-icon');

            if (content.classList.contains('collapsed')) {
                toggleIcon.textContent = '►';
            } else {
                toggleIcon.textContent = '▼';
            }
        }

        // 全部展开按钮
        document.getElementById('expandAll').addEventListener('click', function() {
            const contents = document.querySelectorAll('.account-content');
            contents.forEach((content, index) => {
                content.classList.remove('collapsed');
                const accountInfo = document.querySelector('[data-account-id="' + index + '"]');
                const toggleIcon = accountInfo.querySelector('.toggle-icon');
                toggleIcon.textContent = '▼';
            });
        });

        // 全部折叠按钮
        document.getElementById('collapseAll').addEventListener('click', function() {
            const contents = document.querySelectorAll('.account-content');
            contents.forEach((content, index) => {
                content.classList.add('collapsed');
                const accountInfo = document.querySelector('[data-account-id="' + index + '"]');
                const toggleIcon = accountInfo.querySelector('.toggle-icon');
                toggleIcon.textContent = '►';
            });
        });
    </script>
</body>
</html>
  `;
}
