import {describe, expect, it} from 'vitest';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {historyToCsv, selectHistory} from './historyRecords';

const pay = (id:string, direction:'send'|'receive', status:'completed'|'pending'|'failed', timestamp:number):Payment =>
 ({id, paymentType:direction, status, method:'lightning', timestamp, amount:123456789n, fees:23n}) as unknown as Payment;

describe('SDK-backed transaction history', () => {
  const records = [
    pay('received-1','receive','completed',1720000000),
    pay('sent-2','send','pending',1730000000),
    pay('sent-3','send','failed',1710000000),
  ];
  it('sorts latest first and filters by direction and status without modifying SDK records', () => {
    expect(selectHistory(records,'','all','all').map(tx=>tx.id)).toEqual(['sent-2','received-1','sent-3']);
    expect(selectHistory(records,'','send','all').map(tx=>tx.id)).toEqual(['sent-2','sent-3']);
    expect(selectHistory(records,'','all','pending').map(tx=>tx.id)).toEqual(['sent-2']);
    expect(records.map(tx=>tx.id)).toEqual(['received-1','sent-2','sent-3']);
  });
  it('performs a case-insensitive local search', () => {
    expect(selectHistory(records,'RECEIVED-1','all','all')).toHaveLength(1);
    expect(selectHistory(records,'Lightning','receive','all')).toHaveLength(1);
    expect(selectHistory(records,'not-a-payment','all','all')).toEqual([]);
  });
  it('exports actual integer sats, direction, status and network, not estimates', () => {
    const csv = historyToCsv([records[0]]);
    expect(csv).toContain('"123456789","23"');
    expect(csv).toContain('"received-1","receive","lightning","completed"');
    expect(csv).toContain('Date UTC,Payment ID,Direction,Network,Status,Amount sats,Fee sats');
    expect(csv).not.toContain('INR');
  });
  it('escapes untrusted SDK IDs against CSV formulas and cell breaks', () => {
    const evil = pay('=WEBSERVICE("https://example.invalid")\r\nrow','send','completed',1720000000);
    const csv = historyToCsv([evil]);
    expect(csv).toContain("'=WEBSERVICE");
    expect(csv).toContain('""https://example.invalid""');
    expect(csv).not.toContain('\n=WEBSERVICE');
  });
});
