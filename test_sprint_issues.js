require('dotenv').config();
const jiraService = require('./src/services/jira.service');

async function getSprintIssues() {
    try {
        const jql = `project = "V.25.G.RD.C12.43.S" AND resolution = Unresolved AND sprint IN openSprints() AND sprint NOT IN futureSprints()`;
        let data = await jiraService.searchIssues(jql, ['summary', 'status', 'issuetype', 'customfield_10101']);
        
        console.log("=== ISSUES MATCHING OPEN SPRINTS ===");
        data.issues.forEach(issue => {
            let sData = issue.fields.customfield_10101;
            let sprintState = 'UNKNOWN';
            if (sData) {
                if (Array.isArray(sData)) {
                    sprintState = sData.map(s => s.match(/state=([^,]+)/) ? s.match(/state=([^,]+)/)[1] : s).join(',');
                } else if (typeof sData === 'object' && sData.state) {
                     sprintState = sData.state;
                } else { sprintState = "RAW"; }
            }
            console.log(`[${issue.key}] (${issue.fields.issuetype.name}) ${issue.fields.summary.substr(0, 30)} | Sprints: ${sprintState}`);
        });
    } catch(err) {
        console.error(err);
    }
}
getSprintIssues();
