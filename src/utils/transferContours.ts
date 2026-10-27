/** Exact ray intersection with the logo's rounded rectangular border. */
export function contourPoint(t:number,w:number,h:number,r:number):[number,number]{
 const a=t*Math.PI*2-Math.PI/2,dx=Math.cos(a),dy=Math.sin(a);
 const x=Math.abs(dx),y=Math.abs(dy),hw=w/2,hh=h/2;
 const radius=Math.min(Math.max(0,r),hw,hh);
 let distance=Math.min(hw/Math.max(x,1e-9),hh/Math.max(y,1e-9));
 if(distance*x>hw-radius && distance*y>hh-radius){
  const cx=hw-radius,cy=hh-radius,projection=x*cx+y*cy;
  distance=projection+Math.sqrt(Math.max(0,projection*projection-cx*cx-cy*cy+radius*radius));
 }
 return [dx*distance,dy*distance];
}
