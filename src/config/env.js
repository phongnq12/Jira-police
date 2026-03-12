require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  ACTIVE_NOTIFICATION_PLATFORM: process.env.ACTIVE_NOTIFICATION_PLATFORM || 'teams',
  CRON_SCHEDULE: process.env.CRON_SCHEDULE || '* * * * *', // Mặc định mỗi phút (test mode)

  JIRA: {
    BASE_URL: process.env.JIRA_BASE_URL,
    USERNAME: process.env.JIRA_USERNAME,
    API_TOKEN: process.env.JIRA_API_TOKEN,
    PROJECT_KEY: process.env.JIRA_PROJECT_KEY || 'PROJ',
  },

  TELEGRAM: {
    BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TEST_GROUP_ID: process.env.TELEGRAM_TEST_GROUP_ID,
  },

  TEAMS: {
    WEBHOOK_URL: process.env.TEAMS_WEBHOOK_URL,
  },

  SPRINT_THRESHOLDS: {
    UNDERLOAD_HOURS: parseInt(process.env.SPRINT_UNDERLOAD_HOURS, 10) || 10,
    OVERLOAD_HOURS: parseInt(process.env.SPRINT_OVERLOAD_HOURS, 10) || 40,
  }
};
