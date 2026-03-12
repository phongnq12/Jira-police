const axios = require('axios');
const config = require('../config/env');

/**
 * Service xử lý việc gửi tin nhắn tới Telegram
 */
class TelegramService {
    constructor() {
        this.botToken = config.TELEGRAM.BOT_TOKEN;
        this.testGroupId = config.TELEGRAM.TEST_GROUP_ID;
        this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
    }

    /**
     * Gọi Telegram API để gửi text
     * @param {string} text - Nội dung string message có format markdown
     * @param {string} chatId - ID của nhóm sẽ nhận tin
     */
    async sendMessage(text, chatId = this.testGroupId) {
        if (!this.botToken || !chatId) {
            console.warn('⚠️ Cảnh báo: Cấu hình Telegram (Token/Channel ID) chưa đầy đủ. Bỏ qua gửi tin nhắn.');
            return;
        }

        try {
            const response = await axios.post(`${this.baseUrl}/sendMessage`, {
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML', // Telegram hỗ trợ format MarkdownV2 hoặc HTML. HTML dễ dùng hơn cho in đậm/nghiêng
                disable_web_page_preview: true
            });
            console.log('✅ Đã gửi thành công tin nhắn báo cáo tới Telegram.');
            return response.data;
        } catch (error) {
            console.error('❌ Lỗi khi gửi tin nhắn Telegram:', error.message);
            if (error.response) {
                console.error('Chi tiết lỗi từ Telegram API:', error.response.data);
            }
            throw error;
        }
    }
}

module.exports = new TelegramService();
