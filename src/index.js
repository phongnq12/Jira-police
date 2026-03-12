const express = require('express');
const config = require('./config/env');

const app = express();

// Middleware to parse incoming JSON bodies (essential for Webhooks)
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Jira Master Bot is running' });
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
        // Khởi tạo Polling mode để nằm nghe tin nhắn từ Group Telegram
        const bot = new TelegramBot(config.TELEGRAM.BOT_TOKEN, { polling: true });
        initCommands(bot);
        console.log('🤖 Đã khởi động bộ Lắng nghe lệnh Bot Telegram (Polling).');
    }
}

// Start Server
app.listen(config.PORT, () => {
    console.log(`🚀 Jira Master Bot started on port ${config.PORT}`);
    console.log('--- Sandbox / Môi trường Test ---');
    console.log('Chờ đón Jira Webhook bắn tới...');
});
