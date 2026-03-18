require('dotenv').config();
const jiraService = require('./src/services/jira.service');

async function inspectIssueFields() {
    try {
        const issueKey = "V25GRDC1243S-28"; // Một trong các issue bị bắt nhầm
        console.log(`Inspecting issue: ${issueKey}`);
        
        const response = await jiraService.axiosInstance.get(`/issue/${issueKey}`);
        const fields = response.data.fields;
        
        console.log('--- All Custom Fields with values ---');
        for (const [key, value] of Object.entries(fields)) {
            if (key.startsWith('customfield_') && value !== null) {
                console.log(`${key}:`, JSON.stringify(value).substring(0, 100));
            }
        }
        
        console.log('\n--- Standard Sprint Field ---');
        console.log('sprint:', fields.sprint);

    } catch (err) {
        console.error('Error:', err.message);
    }
}

inspectIssueFields();
