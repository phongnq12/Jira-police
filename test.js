require('dotenv').config();
const jiraService = require('./src/services/jira.service');

async function test() {
    try {
        const jql1 = `project = "V.25.G.RD.C12.43.S" AND issuetype NOT IN (Epic, Story, Task) AND sprint IN openSprints()`;
        console.log('Testing JQL:', jql1);
        const res = await jiraService.searchIssues(jql1, ['summary']);
        console.log('Success:', res.issues.length, 'issues found');
    } catch(err) {
        console.error('Error in Jira Search:', err.response ? err.response.data : err.message);
    }
}
test();
