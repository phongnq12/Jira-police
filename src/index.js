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
                autoStart: false, // Quản lý thủ công để an toàn
                interval: 3000,
                params: { timeout: 10 }
            }
        });

        // Xóa sạch webhook cũ (nếu lỡ cấu hình sai) để không bị lỗi 409 Conflict chặn Polling
        bot.deleteWebHook().then(() => {
            console.log('🤖 Đã xoá Webhook cũ khỏi Telegram, bảo vệ kênh Polling.');
            bot.startPolling();
            console.log('🤖 Đã khởi động bộ Lắng nghe lệnh Bot Telegram (Polling).');
        }).catch(err => {
            console.error('⚠️ [Telegram Bot] Không thể xóa webhook cũ:', err);
            bot.startPolling();
        });

        // Bắt lỗi polling để bot KHÔNG BAO GIỜ crash vì lỗi mạng
        bot.on('polling_error', (error) => {
            console.error(`⚠️ [Telegram Polling] Lỗi mạng: ${error.code || error.message}`);
            // Restart polling nếu bị ngắt kết nối hoàn toàn
            if (error.code === 'EFATAL') {
                console.log('🔄 Đang thử khởi động lại Webhook/Polling...');
                setTimeout(() => {
                    bot.stopPolling().then(() => bot.startPolling());
                }, 5000);
            }
        });

        bot.on('error', (error) => {
            console.error(`⚠️ [Telegram Bot] Lỗi chung: ${error.message}`);
        });

        initCommands(bot);
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
