import React from 'react';
export interface GlowLogoProps {sizePx:number;starsAnimating?:boolean;onClick?:()=>void;imgClassName?:string;alt?:string}
export default function GlowLogo({sizePx,onClick,imgClassName='',alt='GetYourSats'}:GlowLogoProps){return <img src="/assets/getyoursats-mark.jpg" width={sizePx} height={sizePx} alt={alt} onClick={onClick} className={imgClassName} style={{objectFit:'contain',borderRadius:20}}/>}
