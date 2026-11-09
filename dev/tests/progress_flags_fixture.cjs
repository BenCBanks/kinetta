'use strict';

const cp=require('node:child_process');

function setProgressFlags(enabled,project=process.env.KINETTA_PROJECT||'kinettatest'){
 if(!/^(?:kt-[a-z0-9-]+|kinettatest|shots)$/.test(project))throw Error('Progress flag fixtures require a disposable Kinetta project');
 const value=enabled?'true':'false';
 cp.execFileSync('docker',['exec','-i',`${project}-db-1`,'psql','-U','postgres','-d','fit','-v','ON_ERROR_STOP=1','-At'],{input:`INSERT INTO feature_switches (name, enabled) VALUES ('progress_calendar', ${value}), ('progress_segments', ${value}) ON CONFLICT (name) DO UPDATE SET enabled=EXCLUDED.enabled;\n`,encoding:'utf8'});
}

module.exports={setProgressFlags};
