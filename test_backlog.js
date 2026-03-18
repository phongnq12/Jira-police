require('dotenv').config();
const jiraService = require('./src/services/jira.service');

async function checkBacklogIssues() {
    try {
        const projectKey = "V.25.G.RD.C12.43.S";
        
        // Let's get all Unresolved issues to see which ones are in Backlog vs Sprint
        const jql = `project = "${projectKey}" AND resolution = Unresolved ORDER BY created DESC`;
        console.log('Testing JQL:', jql);
        
        const data = await jiraService.searchIssues(jql, ['summary', 'status', 'sprint']);
        
        data.issues.forEach(issue => {
            const sprintData = issue.fields.sprint;
            let sprintInfo = 'EMPTY';
            if (sprintData) {
                if (Array.isArray(sprintData)) {
                    sprintInfo = sprintData.map(s => `${s.name} (${s.state})`).join(', ');
                } else {
                    sprintInfo = `${sprintData.name} (${sprintData.state})`;
                }
            } else {
                sprintInfo = JSON.stringify(issue.fields.sprint);
                
                // Let's inspect raw sprint field just in case
                if (issue.fields.customfield_10101) { // 10101 is what we found before
                     sprintInfo = "Found customfield_10101: " + JSON.stringify(issue.fields.customfield_10101);
                     if (sprintInfo.includes('ACTIVE')) { sprintInfo += " (ACTIVE SPRINT)"; }
                }
            }
            console.log(`[${issue.key}] ${issue.fields.summary.substring(0, 30)} | Status: ${issue.fields.status.name} | Sprint: ${sprintInfo}`);
        });

    } catch (err) {
        console.error('Error:', err.message);
    }
}
checkBacklogIssues();
