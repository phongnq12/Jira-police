require('dotenv').config();
const jiraService = require('./src/services/jira.service');

async function test() {
    try {
        const jql1 = `project = "V.25.G.RD.C12.43.S" AND sprint IN openSprints()`;
        console.log('Testing JQL (no issuetype filter):', jql1);
        const res = await jiraService.searchIssues(jql1, ['summary', 'issuetype']);
        if (res.issues && res.issues.length > 0) {
            console.log('Issues found:', res.issues.length);
            res.issues.forEach(issue => {
                console.log(`- ${issue.key}: ${issue.fields.summary} (${issue.fields.issuetype.name})`);
            });
        } else {
            console.log('No issues found in open sprint.');
        }
    } catch(err) {
        console.error('Error in Jira Search:', err.response ? JSON.stringify(err.response.data, null, 2) : err.message);
    }
}
test();
