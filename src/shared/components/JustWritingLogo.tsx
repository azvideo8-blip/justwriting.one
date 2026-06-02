import React from "react";
import { useLanguage } from "../../shared/i18n";

interface TankLogoProps {
  size?: number;
  variant?: "dark" | "light" | "white";
  showRailway?: boolean;
  showRoman?: boolean;
  showCrown?: boolean;
  className?: string;
}

const COLORS: Record<"dark" | "light" | "white", Record<string, string>> = {
  dark:  { ca:"var(--brand-soft)", inn:"var(--brand-primary)", kf:"#fff", kt:"var(--brand-deep)", rm:"var(--brand-soft)", cr:"var(--brand-soft)", rw:"var(--brand-soft)"},
  light: { ca:"var(--brand-deep)", inn:"var(--brand-primary)", kf:"var(--brand-primary)", kt:"#fff", rm:"var(--brand-deep)", cr:"var(--brand-primary)", rw:"var(--brand-primary)"},
  white: { ca:"#fff", inn:"#fff", kf:"#fff", kt:"var(--brand-deep)", rm:"#fff", cr:"#fff", rw:"#fff"},
};

const RAILWAY_TICKS = Array.from({ length: 28 }, (_, i) => {
  const side = Math.floor(i / 7);
  const pos = i % 7;
  let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
  if (side===0) { x1=42+pos*19; y1=28; x2=x1; y2=34; }
  else if (side===1) { x1=172; y1=42+pos*19; x2=166; y2=y1; }
  else if (side===2) { x1=158-pos*19; y1=172; x2=x1; y2=166; }
  else { x1=28; y1=158-pos*19; x2=34; y2=y1; }
  return { x1, y1, x2, y2 };
});

const RN = [{t:"XII",x:100,y:48},{t:"III",x:158,y:100},{t:"VI",x:100,y:158},{t:"IX",x:42,y:100}];
export function JustWritingLogo({size=32,variant="dark",showRailway=true,showRoman=true,showCrown=true,className}: TankLogoProps) {
  const c = COLORS[variant];
  const { t } = useLanguage();
  return React.createElement("svg",{width:size,height:size,viewBox:"0 0 200 200",fill:"none",xmlns:"http://www.w3.org/2000/svg",className,"aria-label":t('app_name'),role:"img"},
    React.createElement("rect",{x:22,y:22,width:156,height:156,rx:14,stroke:c.ca,strokeWidth:6,fill:"none"}),
    React.createElement("rect",{x:32,y:32,width:136,height:136,rx:10,stroke:c.inn,strokeWidth:2,fill:"none",opacity:.55}),
    showRailway && RAILWAY_TICKS.map((t,i)=>React.createElement("line",{key:"r"+i,x1:t.x1,y1:t.y1,x2:t.x2,y2:t.y2,stroke:c.rw,strokeWidth:1.5,opacity:.6})),
    showRoman && RN.map(r=>React.createElement("text",{key:r.t,x:r.x,y:r.y,textAnchor:"middle",dominantBaseline:"central",fontFamily:"Inter, system-ui, sans-serif",fontSize:12,fill:c.rm,opacity:.7},r.t)),
    React.createElement("rect",{x:62,y:62,width:76,height:76,rx:10,fill:c.kf}),
    React.createElement("text",{x:100,y:122,textAnchor:"middle",fontFamily:"Inter, system-ui, sans-serif",fontSize:56,fill:c.kt,fontWeight:700},"j"),
    showCrown && React.createElement(React.Fragment,null,
      React.createElement("rect",{x:178,y:90,width:6,height:10,rx:1,fill:c.cr}),
      React.createElement("circle",{cx:181,cy:90,r:2.5,fill:c.cr})
    )
  );
}
