const axios = require('axios');
const config = require('../config/env');

/**
 * Service giao tiếp với Hệ thống nội bộ Jira (REST API)
 * Dùng cho Phase 4: Quét Cronjob để xuất báo cáo
 */
class JiraService {
    constructor() {
        // Xử lý thông minh: Thêm https:// tự động nếu bạn vô tình chỉ gõ mỗi tên miền
        let baseUrl = config.JIRA.BASE_URL || '';
        if (baseUrl && !baseUrl.startsWith('http')) {
            baseUrl = `https://${baseUrl}`;
        }

        this.baseUrl = baseUrl;
        this.username = config.JIRA.USERNAME; // Dành cho Jira Cloud hoặc Basic Auth cũ
        this.apiToken = config.JIRA.API_TOKEN; // PAT (Data Center) hoặc API Token (Cloud)
    }

    /**
     * Tự động sinh Header Auth dựa vào việc bạn config PAT hay Mật khẩu
     */
    get axiosInstance() {
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };

        if (this.username && this.apiToken) {
            // Logic xác thực cho Jira Cloud / Jira Server Basic Auth 
            // Khi khai báo đủ [Username + Token] -> Dùng Basic Auth 
            const authtoken = Buffer.from(`${this.username}:${this.apiToken}`).toString('base64');
            headers['Authorization'] = `Basic ${authtoken}`;
        } else if (this.apiToken) {
            // Logic xác thực cho Jira Server Data Center PAT
            // Khi KHÔNG có Username, chỉ có Token -> Dùng chuẩn Bearer Token
            headers['Authorization'] = `Bearer ${this.apiToken}`;
        }

        return axios.create({
            baseURL: `${this.baseUrl}/rest/api/2`,
            headers: {
                ...headers,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
            },
            timeout: 10000 // Timeout 10s tránh treo app khi Jira sập
        });
    }

    /**
     * Quét Issues theo chuỗi JQL tuỳ ý
     * @param {string} jql 
     * @param {Array<string>} fields Liệt kê các field cần lấy để nhẹ payload
     */
    async searchIssues(jql, fields = ['summary', 'status', 'assignee', 'duedate', 'timeoriginalestimate', 'timespent']) {
        try {
            console.log(`[JiraService] Đang cào dữ liệu từ API Jira: JQL = "${jql}"...`);
            const response = await this.axiosInstance.get('/search', {
                params: {
                    jql: jql,
                    maxResults: 50,
                    fields: fields.join(',')
                }
            });
            return response.data;
        } catch (error) {
            console.error('❌ Lỗi khi gọi API Search JQL (Jira):', error.message);
            if (error.response) {
                console.error('Chi tiết Data lỗi từ Jira:', error.response.status, error.response.data);
                console.error('Headers phản hồi:', error.response.headers);
            }
            throw error;
        }
    }
}

module.exports = new JiraService();
