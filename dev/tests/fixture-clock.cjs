'use strict';

const clock = require('../screenshots/fixture-time.json');
const raw = process.env.KINETTA_FIXTURE_INSTANT || clock.instant;
const instant = new Date(raw);

if (typeof raw !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) || !Number.isFinite(instant.getTime())) {
  throw new Error(`KINETTA_FIXTURE_INSTANT must be a timezone-aware ISO instant: ${raw}`);
}

module.exports = { instant, timezone: clock.timezone };
