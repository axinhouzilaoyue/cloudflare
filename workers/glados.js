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
let 积分历史数据 = []; // 新增：存储积分历史数据

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
        } else if (url.pathname == "/checkinChart") {
            // 新增：积分历史图表端点
            await fetchPointsHistory();
            return generateChartResponse();
        }

        return new Response("GLaDOS 多账号签到服务正在运行\n\n可用端点:\n/checkin - 执行签到并查询状态\n/status - 仅查询账号状态\n/tg - 执行签到并发送结果到 Telegram\n/checkinChart - 查看积分历史图表", {
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
    积分历史数据 = []; // 新增：重置积分历史数据

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
    const currentBalance = responseData.list && responseData.list[0] ?
        Math.floor(parseFloat(responseData.list[0].balance)) :
        '未知';

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
// 新增：获取积分历史数据
async function fetchPointsHistory() {
    积分历史数据 = [];

    if (accounts.length === 0) {
        return;
    }

    for (const account of accounts) {
        try {
            // 修改为与签到相同的接口
            const url = "https://glados.rocks/api/user/checkin";
            const headers = generateHeaders(account.cookie);
            const data = { token: "glados.one" };

            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                console.error(`获取积分历史失败: ${response.status} ${response.statusText}`);
                continue;
            }

            const responseData = await response.json();
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
                积分历史数据.push(accountData);
            }
        } catch (error) {
            console.error(`获取账号 ${account.email} 积分历史错误:`, error);
        }
    }
}

// 新增：生成图表响应
function generateChartResponse() {
    // 如果没有数据，返回提示信息
    if (积分历史数据.length === 0) {
        return new Response("未获取到任何积分历史数据，请确保账号配置正确。", {
            status: 200,
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
        });
    }

    // 生成HTML页面，包含Chart.js图表
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GLaDOS 积分历史图表</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            padding: 20px;
        }
        h1 {
            color: #333;
            text-align: center;
            margin-bottom: 30px;
        }
        .chart-container {
            position: relative;
            height: 400px;
            margin-bottom: 30px;
        }
        .account-info {
            margin-top: 40px;
            padding: 15px;
            background-color: #f9f9f9;
            border-radius: 5px;
        }
        .account-title {
            font-weight: bold;
            margin-bottom: 10px;
            color: #333;
            border-bottom: 1px solid #ddd;
            padding-bottom: 5px;
        }
        .stats {
            display: flex;
            flex-wrap: wrap;
            gap: 20px;
            margin-top: 20px;
        }
        .stat-card {
            flex: 1;
            min-width: 200px;
            background-color: white;
            padding: 15px;
            border-radius: 5px;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
        }
        .stat-title {
            font-size: 14px;
            color: #666;
        }
        .stat-value {
            font-size: 24px;
            font-weight: bold;
            margin-top: 5px;
            color: #2c3e50;
        }
        .positive {
            color: #27ae60;
        }
        .negative {
            color: #e74c3c;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>GLaDOS 积分历史图表</h1>

        ${积分历史数据.map((accountData, index) => {
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
            <div class="account-info">
                <div class="account-title">账号: ${accountData.email}</div>

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

                <script>
                    document.addEventListener('DOMContentLoaded', function() {
                        const ctx${index} = document.getElementById('chart${index}').getContext('2d');
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
                                        }
                                    }
                                }
                            }
                        });
                    });
                </script>
            </div>
            `;
        }).join('')}
    </div>
</body>
</html>
    `;

    return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
}
