import test from 'node:test';import assert from 'node:assert/strict';
import {createBilling} from './pi-friendly/billing.mjs';import {legal} from './pi-friendly/legal.mjs';
const connection=async()=>({baseURL:'https://example.com/v1',apiKey:'secret'});
test('billing distinguishes zero balance, expiry, invalid key and transient network failures',async()=>{
 let reply={available:0,expires:Date.now()+999999},status=200;
 const b=createBilling({getConnection:connection,fetcher:async()=>{if(reply===null)throw Error('offline');return Response.json(reply,{status});}});
 await b.refresh();assert.equal(b.snapshot().access,'empty');reply={available:10,expires:1};await b.refresh();assert.equal(b.snapshot().access,'expired');
 reply={available:20,expires:Date.now()+999999};await b.refresh();assert.equal(b.snapshot().access,'ready');reply=null;await b.refresh();assert.equal(b.snapshot().access,'ready');assert.equal(b.snapshot().stale,true);
 reply={error:{code:'invalid_api_key'}};status=401;await b.refresh();assert.equal(b.snapshot().access,'key_expired');
});
test('purchase requires both current consent versions and preserves retry ID',async()=>{
 let calls=[];const b=createBilling({getConnection:connection,fetcher:async(u,o)=>{calls.push({u,o});return Response.json({id:'order',checkout_url:'https://orders.cloudpayments.ru/order'});}});
 await assert.rejects(b.buy({plan:'day',email:'receipt@example.com',consent:{offer:true}}),/оба согласия/);assert.equal(calls.length,0);
 const consent={offer:true,personalData:true,versions:Object.fromEntries(Object.entries(legal).map(([k,v])=>[k,v.version]))};
 const request={plan:'day',email:'receipt@example.com',id:'fixed_request_123456',consent};await b.buy(request);await b.buy(request);assert.equal(calls[0].o.headers['Idempotency-Key'],calls[1].o.headers['Idempotency-Key']);
 assert.equal(JSON.parse(calls[0].o.body).plan_id,'day');assert.equal(calls[0].u,'https://example.com/router/purchases');
});
test('purchase never opens an arbitrary checkout host',async()=>{const b=createBilling({getConnection:connection,fetcher:async()=>Response.json({checkout_url:'https://evil.example/'})});await assert.rejects(b.buy({plan:'day',email:'receipt@example.com',consent:{offer:true,personalData:true,versions:Object.fromEntries(Object.entries(legal).map(([k,v])=>[k,v.version]))}}),/неизвестный адрес/);});
test('older router without payment endpoints shows unavailable offers without crashing',async()=>{
 const b=createBilling({getConnection:connection,fetcher:async()=>new Response('Not found',{status:404})});assert.deepEqual(await b.offers(),{offers:[],test:false});
});

test('email is validated locally and sent for the fiscal receipt',async()=>{let body,calls=0;const b=createBilling({getConnection:connection,fetcher:async(u,o)=>{calls++;body=JSON.parse(o.body);return Response.json({checkout_url:'https://orders.cloudpayments.ru/test'});}});const consent={offer:true,personalData:true,versions:Object.fromEntries(Object.entries(legal).map(([k,v])=>[k,v.version]))};await assert.rejects(b.buy({plan:'day',consent,email:'bad'}),/email/);assert.equal(calls,0);await b.buy({plan:'day',consent,email:' receipt@example.com '});assert.equal(body.receipt_email,'receipt@example.com');});
