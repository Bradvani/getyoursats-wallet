import { describe, expect, it } from 'vitest';
import { unilateralExitEntries } from './listEntries';
import { coin, pendingExit } from './testFixtures';
import type { UnilateralExitEngineState } from './engine';

const row = (over: Partial<UnilateralExitEngineState> = {},fundingUnavailable=false) =>
  unilateralExitEntries({
    plan: null,
    pending: pendingExit(),
    pendingCoins: [],
    nothingToExit: false,
    isStarting: false,
    startError: null,
    archive: [],
    tipHeight: null,
    isAdvancing: false,
    ...over,
  },fundingUnavailable)[0];

describe('a pending exit in the wallet list', () => {
  it.each([{pendingCoins:[]},{pendingCoins:[coin(3_000,false)]},{pendingCoins:[coin(5_898)]}])('does not solicit further funding for a retained browser exit with unavailable continuation %#',({pendingCoins})=>{
    expect(row({pendingCoins},true)).toMatchObject({
      id:'pending',title:'Saved pending exit',
      subtitle:'Additional exit funding is unavailable in this preview. Do not send more bitcoin.',
      amountSat:94_000,isActive:true,
    });
  });
  it('says what to send before anything arrives, and opens the flow', () => {
    expect(row()).toMatchObject({
      title: 'Waiting for exit fee',
      subtitle: 'Send 5 898 sats to start',
      amountSat: 94_000,
      isActive: true,
    });
  });

  it('asks for the rest after a partial payment', () => {
    expect(row({ pendingCoins: [coin(3_000, false)] }).subtitle).toBe('Send 3 034 sats more');
  });

  it('waits on a confirmation once the fee is on its way', () => {
    expect(row({ pendingCoins: [coin(5_898, false)] })).toMatchObject({
      title: 'Exit fee sent',
      subtitle: 'Waiting for a confirmation',
    });
  });

  it('asks to be opened once the fee confirms, since only the user starts the exit', () => {
    expect(row({ pendingCoins: [coin(5_898)] })).toMatchObject({
      title: 'Exit fee received',
      subtitle: 'Open to start it.',
    });
  });
});
