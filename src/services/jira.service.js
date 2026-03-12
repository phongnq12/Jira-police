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
    }

    get axiosInstance() {
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };

        if (this.username && this.apiToken) {
            const authtoken = Buffer.from(`${this.username}:${this.apiToken}`).toString('base64');
            headers['Authorization'] = `Basic ${authtoken}`;
        } else if (this.apiToken) {
            headers['Authorization'] = `Bearer ${this.apiToken}`;
        }

        return axios.create({
            baseURL: `${this.baseUrl}/rest/api/2`,
            headers: {
                ...headers,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
            },
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
     * Quét Issues theo chuỗi JQL tuỳ ý (Có cơ chế tự động Retry)
     */
    async searchIssues(jql, fields = ['summary', 'status', 'assignee', 'duedate', 'timeoriginalestimate', 'timespent']) {
        let lastError;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`[JiraService] Lần thử ${attempt}/${this.maxRetries} - JQL = "${jql}"...`);
                const response = await this.axiosInstance.get('/search', {
                    params: {
                        jql: jql,
                        maxResults: 50,
                        fields: fields.join(',')
                    }
                });
                return response.data;
            } catch (error) {
                lastError = error;
                console.error(`❌ Lần thử ${attempt}/${this.maxRetries} thất bại:`, error.message);

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
}

module.exports = new JiraService();
