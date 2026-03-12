const teamsService = require('./teams.service');
const telegramService = require('./telegram.service');
const config = require('../config/env');

/**
 * Service tổng hợp (Wrapper).
 * Lớp này đứng làm trung gian, module báo cáo (Jira Logic) sẽ chỉ gọi hàm ở đây.
 * Việc gửi qua platform nào là do cấu hình hệ thống quyết định, không dính líu đến logic Jira.
 */
class NotificationService {
    constructor() {
        // Có thể là 'teams', 'telegram', hoặc 'both'
        this.activePlatform = config.ACTIVE_NOTIFICATION_PLATFORM || 'teams';
    }

    /**
     * Gửi cảnh báo / thông báo tới nền tảng được cấu hình.
     * Do Teams nhận JSON Card nhưng Telegram lại nhận String Text (HTML), 
     * class này có nhiệm vụ map format chung ra format riêng của 2 thằng mảng.
     * 
     * @param {string} title Tiêu đề
     * @param {string} markdownBody Nội dung báo cáo (ở dạng HTML để an toàn cho 2 platform)
     * @param {string} alertLevel Cấp độ (info/warning/error) - ánh xạ màu trên Teams 
     */
    async dispatchAlert(title, htmlBody, alertLevel = 'warning') {
        let themeColor = '0076D7'; // Blue - info
        if (alertLevel === 'warning') themeColor = 'F9A825'; // Orange
        if (alertLevel === 'error') themeColor = 'D32F2F';   // Red

        console.log(`[NotificationService] Đang điều phối gửi báo cáo qua nền tảng: ${this.activePlatform}`);

        try {
            if (this.activePlatform === 'teams' || this.activePlatform === 'both') {
                const teamsText = `**${title}**\n\n${htmlBody}`;
                await teamsService.sendSimpleCard(title, teamsText, themeColor);
            }

            if (this.activePlatform === 'telegram' || this.activePlatform === 'both') {
                // Đóng gói title & body để hợp format Telegram
                const telegramEmoji = alertLevel === 'error' ? '🚨' : alertLevel === 'warning' ? '⚠️' : 'ℹ️';
                const telegramText = `<b>${telegramEmoji} ${title}</b>\n\n${htmlBody}`;
                await telegramService.sendMessage(telegramText);
            }
        } catch (error) {
            console.error('[NotificationService] Gặp sự cố không thể dispatch tin nhắn:', error.message);
        }
    }
}

module.exports = new NotificationService();
