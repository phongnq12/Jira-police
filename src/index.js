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

// Khởi tạo Telegram Bot Lắng Nghe Lệnh (Two-way)
const TelegramBot = require('node-telegram-bot-api');
const { initCommands } = require('./controllers/command.controller');
if (config.ACTIVE_NOTIFICATION_PLATFORM === 'telegram' || config.ACTIVE_NOTIFICATION_PLATFORM === 'both') {
    if (config.TELEGRAM.BOT_TOKEN) {
        const bot = new TelegramBot(config.TELEGRAM.BOT_TOKEN, {
            polling: {
                autoStart: true,
                interval: 3000,  // 3 giây/lần thay vì mặc định (giảm tải mạng)
                params: { timeout: 10 }
            }
        });

        // Bắt lỗi polling để bot KHÔNG BAO GIỜ crash vì lỗi mạng
        bot.on('polling_error', (error) => {
            console.error(`⚠️ [Telegram Polling] Lỗi mạng (em tự thử lại): ${error.code || error.message}`);
        });

        bot.on('error', (error) => {
            console.error(`⚠️ [Telegram Bot] Lỗi chung: ${error.message}`);
        });

        initCommands(bot);
        console.log('🤖 Đã khởi động bộ Lắng nghe lệnh Bot Telegram (Polling - có bảo vệ lỗi mạng).');
    }
}

// Bảo vệ process-level: Không cho app crash vì lỗi không bắt được
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ [Process] Unhandled Rejection:', reason?.message || reason);
});

process.on('uncaughtException', (error) => {
    console.error('⚠️ [Process] Uncaught Exception:', error.message);
});

// Start Server
app.listen(config.PORT, () => {
    console.log(`🚀 Jira Master Bot started on port ${config.PORT}`);
    console.log('Chờ đón Jira Webhook bắn tới...');
});
