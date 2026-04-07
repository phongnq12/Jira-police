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
    let conflict409Count = 0;
    let isRestarting = false;
    let pollingStarted = false;

    /**
     * Hàm khởi động polling an toàn (có retry + flush getUpdates)
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

        // Flush pending getUpdates - đánh dấu đã đọc hết update cũ
        // để tránh conflict với instance cũ
        try {
            const https = require('https');
            await new Promise((resolve, reject) => {
                const req = https.get(
                    `https://api.telegram.org/bot${config.TELEGRAM.BOT_TOKEN}/getUpdates?offset=-1&timeout=0`,
                    (res) => {
                        let data = '';
                        res.on('data', (chunk) => data += chunk);
                        res.on('end', () => {
                            console.log('🤖 Đã flush pending updates từ Telegram.');
                            resolve();
                        });
                    }
                );
                req.on('error', (e) => {
                    console.log('⚠️ Flush updates failed (non-critical):', e.message);
                    resolve(); // không block
                });
                req.setTimeout(5000, () => { req.destroy(); resolve(); });
            });
        } catch (e) { /* ignore */ }

        // Chờ thêm 2s sau flush để đảm bảo instance cũ đã ngắt
        await new Promise(r => setTimeout(r, 2000));

        try {
            await bot.startPolling();
            pollingStarted = true;
            consecutiveErrors = 0;
            conflict409Count = 0;
            console.log('🤖 ✅ Telegram Polling đã khởi động thành công!');
        } catch (e) {
            console.error('❌ Không thể startPolling:', e.message);
            pollingStarted = false;
        }
        isRestarting = false;
    }

    // Bắt lỗi polling - auto recovery
    bot.on('polling_error', (error) => {
        const is409 = error.response && error.response.statusCode === 409;
        const details = error.response
            ? `HTTP ${error.response.statusCode}: ${JSON.stringify(error.response.body || '').substring(0, 200)}`
            : error.message;

        if (is409) {
            // 409 Conflict = instance cũ chưa tắt, KHÔNG đếm vào consecutive errors
            conflict409Count++;
            console.warn(`⚠️ [Telegram] 409 Conflict #${conflict409Count} — instance cũ chưa tắt, chờ...`);

            // Exponential backoff: 10s → 20s → 40s → 80s max
            if (!isRestarting) {
                const backoffSec = Math.min(10 * Math.pow(2, conflict409Count - 1), 80);
                console.log(`🔄 [Telegram] Retry sau ${backoffSec}s (backoff #${conflict409Count})...`);
                setTimeout(() => safeStartPolling(), backoffSec * 1000);
            }
            return; // không xử lý thêm
        }

        // Lỗi thật (không phải 409)
        consecutiveErrors++;
        console.error(`⚠️ [Telegram Polling] Error #${consecutiveErrors}: ${error.code || 'ERROR'} — ${details}`);

        // Auto-restart sau 5 lỗi thật liên tiếp
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
        if (consecutiveErrors > 0 || conflict409Count > 0) {
            console.log(`[Telegram] ✅ Polling OK. Reset counters (errors: ${consecutiveErrors}, 409s: ${conflict409Count}).`);
            consecutiveErrors = 0;
            conflict409Count = 0;
        }
    });

    initCommands(bot);

    // KHỞI ĐỘNG: Delay 10s để instance cũ trên Render kịp tắt (5s không đủ)
    console.log('🤖 Chờ 10 giây trước khi khởi động Telegram Polling...');
    setTimeout(() => safeStartPolling(), 10000);

    // HEALTH CHECK: Kiểm tra polling mỗi 90 giây
    // Tăng từ 60s lên 90s để tránh restart quá sớm khi đang backoff 409
    setInterval(() => {
        if (!pollingStarted && !isRestarting) {
            console.log('🔄 [HealthCheck] Polling chưa khởi động. Thử lại...');
            safeStartPolling();
        } else if (consecutiveErrors >= 5 && !isRestarting) {
            console.log(`🔄 [HealthCheck] Detected ${consecutiveErrors} consecutive errors. Restarting...`);
            safeStartPolling();
        }
    }, 90000);
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
