const axios = require('axios');
const FormData = require('form-data');
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

    /**
     * Gửi ảnh (Buffer) kèm caption qua Telegram API
     * @param {Buffer} photoBuffer - Buffer ảnh PNG
     * @param {string} caption - Caption dưới ảnh (hỗ trợ HTML)
     * @param {string} chatId - ID nhóm nhận
     */
    async sendPhoto(photoBuffer, caption = '', chatId = this.testGroupId) {
        if (!this.botToken || !chatId) {
            console.warn('⚠️ Cảnh báo: Cấu hình Telegram chưa đầy đủ. Bỏ qua gửi ảnh.');
            return;
        }

        try {
            const form = new FormData();
            form.append('chat_id', chatId);
            form.append('photo', photoBuffer, { filename: 'chart.png', contentType: 'image/png' });
            if (caption) {
                form.append('caption', caption);
                form.append('parse_mode', 'HTML');
            }

            const response = await axios.post(`${this.baseUrl}/sendPhoto`, form, {
                headers: form.getHeaders()
            });
            console.log('✅ Đã gửi thành công ảnh báo cáo tới Telegram.');
            return response.data;
        } catch (error) {
            console.error('❌ Lỗi khi gửi ảnh Telegram:', error.message);
            if (error.response) {
                console.error('Chi tiết lỗi:', error.response.data);
            }
            throw error;
        }
    }

    /**
     * Gửi file tài liệu (Buffer) qua Telegram API
     * @param {Buffer} docBuffer - Buffer file (VD: .xlsx)
     * @param {string} filename - Tên file hiển thị cho người nhận
     * @param {string} caption - Caption kèm theo
     * @param {string} chatId - ID nhóm nhận
     */
    async sendDocument(docBuffer, filename = 'report.xlsx', caption = '', chatId = this.testGroupId) {
        if (!this.botToken || !chatId) {
            console.warn('⚠️ Cảnh báo: Cấu hình Telegram chưa đầy đủ. Bỏ qua gửi file.');
            return;
        }

        try {
            const form = new FormData();
            form.append('chat_id', chatId);
            form.append('document', docBuffer, { filename, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            if (caption) {
                form.append('caption', caption);
                form.append('parse_mode', 'HTML');
            }

            const response = await axios.post(`${this.baseUrl}/sendDocument`, form, {
                headers: form.getHeaders()
            });
            console.log('✅ Đã gửi thành công file tài liệu tới Telegram.');
            return response.data;
        } catch (error) {
            console.error('❌ Lỗi khi gửi file Telegram:', error.message);
            if (error.response) {
                console.error('Chi tiết lỗi:', error.response.data);
            }
            throw error;
        }
    }
}

module.exports = new TelegramService();

