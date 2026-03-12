const axios = require('axios');
const config = require('../config/env');

/**
 * Service xử lý việc gửi tin nhắn tới Microsoft Teams thông qua Incoming Webhook
 */
class TeamsService {
    constructor() {
        this.webhookUrl = config.TEAMS.WEBHOOK_URL;
    }

    /**
     * Gửi cấu trúc Message Card (Adaptive Card / Office 365 Connector Card) tới Teams
     * @param {Object} messagePayload - Cấu trúc JSON của Teams Card
     */
    async sendMessage(messagePayload) {
        if (!this.webhookUrl) {
            console.warn('⚠️ Cảnh báo: TEAMS_WEBHOOK_URL chưa được cấu hình. Bỏ qua việc gửi tin nhắn Teams.');
            return;
        }

        try {
            const response = await axios.post(this.webhookUrl, messagePayload);
            console.log('✅ Đã gửi thành công tin nhắn báo cáo tới Teams.');
            return response.data;
        } catch (error) {
            console.error('❌ Lỗi khi gửi tin nhắn Teams:', error.message);
            if (error.response) {
                console.error('Chi tiết lỗi từ Teams API:', error.response.data);
            }
            throw error;
        }
    }

    /**
     * Format nội dung thành cấu trúc Card cơ bản của Teams
     * @param {string} title - Tiêu đề báo cáo
     * @param {string} text - Nội dung chi tiết (hỗ trợ Markdown cơ bản)
     * @param {string} themeColor - Mã màu của thẻ (VD: 'FF0000' cho lỗi)
     */
    async sendSimpleCard(title, text, themeColor = '0076D7') {
        const payload = {
            '@type': 'MessageCard',
            '@context': 'http://schema.org/extensions',
            themeColor: themeColor,
            title: title,
            text: text,
            // Có thể mở rộng thêm sections, buttons (potentialAction) nếu cần
        };

        return this.sendMessage(payload);
    }
}

module.exports = new TeamsService();
