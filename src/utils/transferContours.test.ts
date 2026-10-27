import {describe,it,expect} from 'vitest';
import {contourPoint} from './transferContours';
describe('logo border geometry',()=>{
 it('starts exactly on the approved logo boundary at the four cardinal points',()=>{
  const expected=[[0,-56],[56,0],[0,56],[-56,0]];
  expected.forEach(([x,y],i)=>{const point=contourPoint(i/4,112,112,112*110/512);expect(point[0]).toBeCloseTo(x);expect(point[1]).toBeCloseTo(y);});
 });
 it('has finite bounded coordinates at mobile and desktop dimensions',()=>{
  for(const [w,h] of [[112,112],[320,640],[1366,900]])for(let i=0;i<=80;i++){
   const [x,y]=contourPoint(i/80,w,h,24);expect(Number.isFinite(x+y)).toBe(true);expect(Math.abs(x)).toBeLessThanOrEqual(w/2+.001);expect(Math.abs(y)).toBeLessThanOrEqual(h/2+.001);
  }
 });
});
