// Only for suites that intercept the setting write and model persisted state themselves.
// Real ticket expiry, in-flight locks, identity and ordering use privacy_save_incontainer.py.
'use strict';
let ticket=0;
module.exports=async route=>{
 if(new URL(route.request().url()).pathname!=='/api/privacy-save')return false;
 await route.fulfill({json:route.request().method()==='POST'?{ticket:'fictional-'+(++ticket)}:{settled:true}});
 return true;
};
