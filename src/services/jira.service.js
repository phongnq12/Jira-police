const axios = require('axios');
const config = require('../config/env');

/**
 * Service giao tiếp với Hệ thống nội bộ Jira (REST API)
 */
class JiraService {
    constructor() {
        let baseUrl = config.JIRA.BASE_URL || '';
        if (baseUrl && !baseUrl.startsWith('http')) {
            baseUrl = `https://${baseUrl}`;
        }

        this.baseUrl = baseUrl;
        this.username = config.JIRA.USERNAME;
        this.apiToken = config.JIRA.API_TOKEN;
        this.maxRetries = 3;
        this.retryDelay = 2000; // 2 giây giữa các lần thử

        // Cache axios instance (tái sử dụng connection pool, không tạo mới mỗi lần gọi)
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
        };

        if (this.username && this.apiToken) {
            const authtoken = Buffer.from(`${this.username}:${this.apiToken}`).toString('base64');
            headers['Authorization'] = `Basic ${authtoken}`;
        } else if (this.apiToken) {
            headers['Authorization'] = `Bearer ${this.apiToken}`;
        }

        this._axiosInstance = axios.create({
            baseURL: `${this.baseUrl}/rest/api/2`,
            headers,
            timeout: 15000 // 15s cho môi trường cloud (cold start)
        });
    }

    /**
     * Hàm sleep để chờ giữa các lần retry
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Gọi 1 trang kết quả từ Jira API (có cơ chế Retry)
     * @param {string} jql Chuỗi JQL
     * @param {string[]} fields Danh sách trường cần trả về
     * @param {number} startAt Vị trí bắt đầu (phân trang)
     * @param {number} maxResults Số kết quả tối đa mỗi trang
     * @returns {object} Dữ liệu response từ Jira
     */
    async _fetchPage(jql, fields, startAt = 0, maxResults = 50) {
        let lastError;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await this._axiosInstance.get('/search', {
                    params: {
                        jql,
                        startAt,
                        maxResults,
                        fields: fields.join(',')
                    }
                });
                return response.data;
            } catch (error) {
                lastError = error;
                console.error(`❌ Lần thử ${attempt}/${this.maxRetries} thất bại (startAt=${startAt}):`, error.message);

                if (attempt < this.maxRetries) {
                    console.log(`⏳ Đợi ${this.retryDelay / 1000}s rồi thử lại...`);
                    await this.sleep(this.retryDelay);
                }
            }
        }

        console.error('❌ Đã thử hết số lần retry mà vẫn lỗi!');
        if (lastError.response) {
            console.error('Chi tiết:', lastError.response.status, lastError.response.data);
        }
        throw lastError;
    }

    /**
     * Quét Issues theo chuỗi JQL tuỳ ý — TỰ ĐỘNG PHÂN TRANG
     * Lặp lại cho đến khi lấy hết toàn bộ issues, không giới hạn 50 nữa.
     */
    async searchIssues(jql, fields = ['summary', 'status', 'assignee', 'duedate', 'timeoriginalestimate', 'timespent']) {
        const pageSize = 50;
        let startAt = 0;
        let allIssues = [];
        let total = 0;

        console.log(`[JiraService] Bắt đầu quét: JQL = "${jql}"`);

        do {
            const data = await this._fetchPage(jql, fields, startAt, pageSize);
            total = data.total || 0;

            if (data.issues && data.issues.length > 0) {
                allIssues = allIssues.concat(data.issues);
                console.log(`[JiraService] Pagination: Fetched page ${Math.floor(startAt / pageSize) + 1} — ${allIssues.length}/${total} issues`);
            }

            startAt += pageSize;
        } while (startAt < total);

        console.log(`[JiraService] Hoàn tất: Tổng cộng ${allIssues.length} issues.`);

        // Trả về cùng cấu trúc { total, issues } để không phá vỡ code hiện tại
        return { total, issues: allIssues };
    }
}

module.exports = new JiraService();
