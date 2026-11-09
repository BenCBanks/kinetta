'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('app/static/pages.js', 'utf8');
const start = source.indexOf('function matchedRouteTrendHeadline');
const end = source.indexOf("route(/^\\/route", start);
assert(start >= 0 && end > start, 'matched-route headline helper is present');
const context = {
  MI: 1609.344,
  U: {pu: () => '/mi', su: () => 'mph', speed: value => Number(value).toFixed(1)},
  imp: () => false,
  Number,
};
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}\nglobalThis.matchedRouteTrendHeadline = matchedRouteTrendHeadline;`, context);

const headline = context.matchedRouteTrendHeadline;
assert.match(headline({slope_per_day: -0.1}, [{y: 300}], true), /^Getting faster: about 3 s\/mi per month on this route\.$/, 'runs show a rounded pace trend');
assert.match(headline({slope_per_day: -0.1}, [{y: 200}], false), /^Getting faster: about 0\.1 mph per month on this route\.$/, 'rides show a speed trend');
assert.equal(headline({slope_per_day: -1 / 30}, [{y: 200}], false), '', 'a ride trend that formats as 0.0 is omitted');
assert.equal(headline(null, [], false), '', 'routes without trend data have no headline');
console.log('Matched route headline: run pace, ride speed, zero-rounding and no-data cases PASS');
