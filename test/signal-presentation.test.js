import test from 'node:test';
import assert from 'node:assert/strict';
import {groupSignals,signalMetrics} from '../app/components/signal-presentation.js';
test('presentation prioritizes severity/confidence and groups without mutation or signal loss',()=>{
 const records=[{signal_id:'a',player_id:'1',severity:'context',confidence:'high',type:'ROLE_STABILITY'},{signal_id:'b',player_id:'2',severity:'notable',confidence:'low',type:'ROLE_EXPANSION'},{signal_id:'c',player_id:'1',severity:'notable',confidence:'moderate',type:'SNAP_SHARE_SPIKE'}];
 const before=JSON.stringify(records),groups=groupSignals(records);
 assert.equal(groups[0][0].signal_id,'c');assert.equal(groups[0].length,2);assert.equal(groups.flat().length,3);assert.equal(JSON.stringify(records),before);
});
test('signal summaries preserve units and do not invent missing history',()=>{
 assert.deepEqual(signalMetrics({type:'TARGET_SHARE_SPIKE',evidence:{weekly:[.12,.25]}}),['Target share: 12% → 25%']);
 assert.deepEqual(signalMetrics({type:'XFP_BREAKOUT',evidence:{weekly:[8,13]}}),['xFP: 8.0 → 13.0']);
 assert.deepEqual(signalMetrics({type:'ROLE_EXPANSION',evidence:{snap_share:[null,.7]}}),[]);
});
