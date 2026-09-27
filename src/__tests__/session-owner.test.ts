import { jest } from '@jest/globals';
import { ControlClient, SecretToken, SessionId, SessionOwner, type SessionCredentials } from '../control/index.js';

const credentials: SessionCredentials = Object.freeze({sessionId:new SessionId('session_123'),sourceToken:new SecretToken('initial-secret'),requiredBuses:['application','microphone'],whipUrl:null,whepUrl:null,iceServers:[]});
const json = (payload: unknown,status=200):Response => new Response(JSON.stringify(payload),{status});
const renewed = (token:string,ttlMs=1000):Response => json({source_token:token,expires_at:new Date(Date.now()+ttlMs).toISOString()});

beforeEach(()=>{jest.useFakeTimers();jest.setSystemTime(new Date('2030-01-01T00:00:00Z'));});
afterEach(()=>{jest.useRealTimers();});

test('given an owned Session when its credential reaches half life then renewal and deletion use the newest capability',async()=>{
 const authorizations:string[]=[];let sequence=0;
 const client=new ControlClient('https://service.example',{fetch:async(input,init)=>{const req=new Request(input,init);authorizations.push(req.headers.get('authorization')??'');return req.method==='DELETE'?new Response(null,{status:204}):renewed(`replacement-${++sequence}`);}});
 const owner=await SessionOwner.maintain(client,credentials);
 expect(owner.credentials.sourceToken.exposeSecret()).toBe('replacement-1');
 await jest.advanceTimersByTimeAsync(1500);
 expect(sequence).toBe(4);
 await owner.close();await owner.close();
 expect(authorizations).toEqual(['Bearer initial-secret','Bearer replacement-1','Bearer replacement-2','Bearer replacement-3','Bearer replacement-4']);
 await jest.advanceTimersByTimeAsync(10000);expect(sequence).toBe(4);expect(jest.getTimerCount()).toBe(0);
 expect(String(owner)+JSON.stringify(owner)).not.toContain('replacement');client.close();
});

test('given close during renewal when the bounded response completes then cleanup waits and uses that replacement',async()=>{
 let complete:((response:Response)=>void)|undefined;const events:string[]=[];let renewals=0;
 const client=new ControlClient('https://service.example',{fetch:async(input,init)=>{const req=new Request(input,init);events.push(`${req.method}:${req.headers.get('authorization')}`);if(req.method==='DELETE')return new Response(null,{status:204});if(++renewals===1)return renewed('first');return await new Promise<Response>(resolve=>{complete=resolve;});}});
 const owner=await SessionOwner.maintain(client,credentials);await jest.advanceTimersByTimeAsync(500);
 const closed=owner.close();expect(events).toHaveLength(2);complete?.(renewed('second'));await closed;
 expect(events).toEqual(['POST:Bearer initial-secret','POST:Bearer first','DELETE:Bearer second']);expect(jest.getTimerCount()).toBe(0);client.close();
});

test('given transient renewal failures when the retry budget ends then failure is observable and cleanup cannot claim success',async()=>{
 let renewals=0,deletions=0;
 const client=new ControlClient('https://service.example',{fetch:async(input,init)=>{const req=new Request(input,init);if(req.method==='DELETE'){deletions++;return new Response(null,{status:204});}return ++renewals===1?renewed('first',10000):json({source_token:'unknown-sensitive-response'},503);}});
 const owner=await SessionOwner.maintain(client,credentials);await jest.advanceTimersByTimeAsync(6000);
 expect(renewals).toBe(4);expect(owner.failureSignal.aborted).toBe(true);expect(String(owner.failureSignal.reason)).not.toContain('unknown-sensitive-response');expect(owner.failure).toMatchObject({code:'control.owner_renewal_failed'});expect(()=>owner.assertActive()).toThrow();
 await expect(owner.close()).rejects.toMatchObject({code:'control.owner_renewal_failed'});expect(deletions).toBe(1);expect(String(owner.failure)).not.toContain('unknown-sensitive-response');expect(jest.getTimerCount()).toBe(0);client.close();
});

test('given permanent denial when renewal runs then it does not retry or retain response credentials',async()=>{
 let renewals=0;const client=new ControlClient('https://service.example',{fetch:async()=>++renewals===1?renewed('first'):json({source_token:'unknown-sensitive-response'},404)});
 const owner=await SessionOwner.maintain(client,credentials);await jest.advanceTimersByTimeAsync(500);expect(renewals).toBe(2);
 await expect(owner.close({deleteRemoteSession:false})).rejects.toMatchObject({code:'control.owner_renewal_failed'});expect(jest.getTimerCount()).toBe(0);client.close();
});

test('given an invalid renewal response when bootstrapping then no background task starts',async()=>{
 for(const payload of [{source_token:'new-secret',expires_at:'invalid'},{source_token:'new-secret',expires_at:'2020-01-01T00:00:00Z'}]){
  const client=new ControlClient('https://service.example',{fetch:async()=>json(payload)});
  await expect(SessionOwner.maintain(client,credentials)).rejects.toThrow();expect(jest.getTimerCount()).toBe(0);client.close();
 }
});
