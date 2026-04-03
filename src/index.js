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
    if (config.ACTIVE_NOTIFICATION_PLATFORM !== 'telegram' && config.ACTIVE_NOTIFICATION_PLATFORM !== 'both') {
        console.log('⏭ Bỏ qua Telegram Bot (Platform:', config.ACTIVE_NOTIFICATION_PLATFORM, ')');
        return;
    }
    if (!config.TELEGRAM.BOT_TOKEN) {
        console.log('⏭ Bỏ qua Telegram Bot (Chưa cấu hình BOT_TOKEN)');
        return;
    }

    const TelegramBot = require('node-telegram-bot-api');
    const { initCommands } = require('./controllers/command.controller');

    const bot = new TelegramBot(config.TELEGRAM.BOT_TOKEN, {
        polling: {
            autoStart: false,
            interval: 3000,
            params: { timeout: 10 }
        }
    });

    let consecutiveErrors = 0;
    let isRestarting = false;
    let pollingStarted = false;

    /**
     * Hàm khởi động polling an toàn (có retry)
     */
    async function safeStartPolling() {
        if (isRestarting) return;
        isRestarting = true;
        try {
            await bot.stopPolling();
        } catch (e) { /* ignore */ }

        try {
            await bot.deleteWebHook();
            console.log('🤖 Đã xoá Webhook cũ khỏi Telegram.');
        } catch (e) {
            console.error('⚠️ Không thể xóa Webhook:', e.message);
        }

        try {
            await bot.startPolling();
            pollingStarted = true;
            consecutiveErrors = 0;
            console.log('🤖 ✅ Telegram Polling đã khởi động thành công!');
        } catch (e) {
            console.error('❌ Không thể startPolling:', e.message);
            pollingStarted = false;
        }
        isRestarting = false;
    }

    // Bắt lỗi polling - auto recovery
    bot.on('polling_error', (error) => {
        consecutiveErrors++;
        const details = error.response
            ? `HTTP ${error.response.statusCode}: ${JSON.stringify(error.response.body || '').substring(0, 200)}`
            : error.message;
        console.error(`⚠️ [Telegram Polling] Error #${consecutiveErrors}: ${error.code || 'ERROR'} — ${details}`);

        // Auto-restart sau 5 lỗi liên tiếp
        if (consecutiveErrors >= 5 && !isRestarting) {
            console.log('🔄 Quá nhiều lỗi polling liên tiếp. Tự động restart sau 15s...');
            setTimeout(() => safeStartPolling(), 15000);
        }

        // EFATAL = mất kết nối hoàn toàn
        if (error.code === 'EFATAL' && !isRestarting) {
            console.log('🔄 EFATAL detected. Restart polling sau 10s...');
            setTimeout(() => safeStartPolling(), 10000);
        }
    });

    bot.on('error', (error) => {
        console.error(`⚠️ [Telegram Bot] Lỗi chung: ${error.message}`);
    });

    // Reset error counter khi nhận được message thành công
    bot.on('message', () => {
        if (consecutiveErrors > 0) {
            console.log(`[Telegram] ✅ Polling hoạt động bình thường. Reset error counter (was ${consecutiveErrors}).`);
            consecutiveErrors = 0;
        }
    });

    initCommands(bot);

    // KHỞI ĐỘNG: Delay 5s để instance cũ trên Render kịp tắt
    console.log('🤖 Chờ 5 giây trước khi khởi động Telegram Polling...');
    setTimeout(() => safeStartPolling(), 5000);

    // HEALTH CHECK: Kiểm tra polling mỗi 60 giây
    setInterval(() => {
        if (!pollingStarted && !isRestarting) {
            console.log('🔄 [HealthCheck] Polling chưa khởi động. Thử lại...');
            safeStartPolling();
        } else if (consecutiveErrors >= 3 && !isRestarting) {
            console.log(`🔄 [HealthCheck] Detected ${consecutiveErrors} consecutive errors. Restarting...`);
            safeStartPolling();
        }
    }, 60000);
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
