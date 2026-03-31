const express = require('express');
const config = require('./config/env');

const app = express();

// Middleware to parse incoming JSON bodies (essential for Webhooks)
app.use(express.json());

// Health check endpoint (chi tiết)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Jira Master Bot is running' });
});

// Ping endpoint (siêu nhẹ - dùng cho cron-job.org giữ ấm Render)
app.get('/ping', (req, res) => {
    res.status(200).send('OK');
});

// Jira Webhook Endpoint
const { handleJiraWebhook } = require('./controllers/webhook.controller');
app.post('/api/webhooks/jira', handleJiraWebhook);

// Khởi chạy Scheduled Cronjobs
const { initCronJobs } = require('./controllers/cron.controller');
initCronJobs();

// Hàm khởi tạo Telegram Bot (gọi SAU KHI server đã bind port thành công)
function initTelegramBot() {
    if (config.ACTIVE_NOTIFICATION_PLATFORM !== 'telegram' && config.ACTIVE_NOTIFICATION_PLATFORM !== 'both') return;
    if (!config.TELEGRAM.BOT_TOKEN) return;

    const TelegramBot = require('node-telegram-bot-api');
    const { initCommands } = require('./controllers/command.controller');

    const bot = new TelegramBot(config.TELEGRAM.BOT_TOKEN, {
        polling: {
            autoStart: false,
            interval: 3000,
            params: { timeout: 10 }
        }
    });

    // Delay 5s để instance cũ trên Render kịp tắt polling, tránh 409 Conflict
    console.log('🤖 Chờ 5 giây trước khi khởi động Telegram Polling (tránh 409 Conflict)...');
    setTimeout(() => {
        bot.deleteWebHook().then(() => {
            console.log('🤖 Đã xoá Webhook cũ khỏi Telegram, bảo vệ kênh Polling.');
            bot.startPolling();
            console.log('🤖 Đã khởi động bộ Lắng nghe lệnh Bot Telegram (Polling).');
        }).catch(err => {
            console.error('⚠️ [Telegram Bot] Không thể xóa webhook cũ:', err.message);
            bot.startPolling();
        });
    }, 5000);

    // Bắt lỗi polling - log CHI TIẾT để debug trên Render
    bot.on('polling_error', (error) => {
        const details = error.response ? `HTTP ${error.response.statusCode}: ${JSON.stringify(error.response.body || '').substring(0, 200)}` : error.message;
        console.error(`⚠️ [Telegram Polling] ${error.code || 'ERROR'}: ${details}`);

        if (error.code === 'EFATAL') {
            console.log('🔄 Đang thử khởi động lại Polling sau 10s...');
            setTimeout(() => {
                bot.stopPolling().then(() => bot.startPolling());
            }, 10000);
        }
    });

    bot.on('error', (error) => {
        console.error(`⚠️ [Telegram Bot] Lỗi chung: ${error.message}`);
    });

    initCommands(bot);
}

// Bảo vệ process-level: Không cho app crash vì lỗi không bắt được
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ [Process] Unhandled Rejection:', reason?.message || reason);
});

process.on('uncaughtException', (error) => {
    console.error('⚠️ [Process] Uncaught Exception:', error.message);
});

// Start Server — PHẢI bind 0.0.0.0 explicitly cho Render port scanner
const HOST = '0.0.0.0';
app.listen(config.PORT, HOST, () => {
    console.log(`🚀 Jira Master Bot started on ${HOST}:${config.PORT}`);
    console.log('Chờ đón Jira Webhook bắn tới...');

    // Khởi tạo Telegram Bot SAU KHI server đã bind port thành công
    initTelegramBot();
});
