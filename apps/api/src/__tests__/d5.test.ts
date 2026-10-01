import {describe,it,expect} from 'vitest';
import {app} from '../app';
describe('D5 owner delivery',()=>{
 it('exports fixture mappings and an Oida-compatible observation feed without promoting evidence',async()=>{
  const response=await app.request('/api/generation-frame?mode=fixture');expect(response.status).toBe(200);
  const frame=await response.json() as {acquisitionMode:string;receipts:unknown[];execution:string};expect(frame.acquisitionMode).toBe('fixture');expect(frame.receipts).toHaveLength(3);expect(frame.execution).toBe('not_requested');
  const feedResponse=await app.request('/api/observation-feed?mode=fixture&sources=carbon_intensity_gb');expect(feedResponse.status).toBe(200);
  const feed=await feedResponse.json() as {relation:{of:string};source_register:string;producer:{acquisitionMode:string};source_record:{observations:unknown[]}};expect(feed.relation.of).toBe('signal');expect(feed.source_register).toBe('non-acoustic');expect(feed.producer.acquisitionMode).toBe('fixture');expect(feed.source_record.observations.length).toBeGreaterThan(0);
 });
});
