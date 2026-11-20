/* Mangrove — WebGL scene.
   A liquid-chrome mangrove standing in black water. The camera descends with
   the page scroll: canopée (haut de page) -> ligne d'eau -> marée -> racines (bibliothèque), and
   the underwater roots light up as you reach the library.
   Plain WebGL 1, no libraries, works from file://. */
(function () {
  'use strict';
  var cv = document.getElementById('gl');
  if (!cv) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var gl = null;
  try { gl = cv.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' }); } catch (e) { gl = null; }
  if (!gl) { document.documentElement.classList.add('no-gl'); return; }

  var VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  var FS = [
    'precision highp float;',
    'uniform vec2 R;uniform float T;uniform vec3 CAM;uniform vec3 TGT;uniform vec2 M;uniform float MF;uniform float L;uniform float G;uniform float D;',
    'const float WL=-1.0;',
    'vec3 MP;',
    'float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}',
    'float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}',
    'float cap(vec3 p,vec3 a,vec3 b,float r){vec3 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h)-r;}',
    /* one prop root: a quarter arc from the trunk down into the water, then a straight run into the mud */
    'float root(vec3 p,float i){',
    '  float ang=i*.8976+.35*sin(i*2.3);float h=.28+.3*fract(i*.618);float d=1.7+.4*fract(i*.377+.2);',
    '  vec2 dir=vec2(cos(ang),sin(ang));float x=dot(p.xz,dir),z=dot(p.xz,vec2(-dir.y,dir.x));',
    '  float r=d-.12;vec2 v=vec2(x-d,p.y-h);vec2 e1=vec2(-r,0.),e2=vec2(0.,-r);',
    '  vec2 n=(v.x<0.&&v.y<0.)?normalize(v)*r:(length(v-e1)<length(v-e2)?e1:e2);',
    '  float k=clamp(-v.y/r,0.,1.);',
    '  float a=length(vec3(v-n,z))-(.085-.03*k);',
    '  float b=cap(vec3(x,p.y,z),vec3(d,h-r,0.),vec3(d+.3,h-r-3.2,0.),.055);',
    '  return smin(a,b,.1);',
    '}',
    'float canopy(vec3 p){',
    '  float t=T*.4;vec3 s=vec3(p.x,1.8+(p.y-1.8)*1.55,p.z);',
    '  float c=length(s-vec3(0.,1.8,0.))-.8;',
    '  for(int i=0;i<5;i++){float f=float(i);',
    '    vec3 q=vec3(sin(t*.6+f*1.26)*1.25,1.8+cos(t*.5+f*1.7)*.22,cos(t*.45+f*1.26)*.95);',
    '    c=smin(c,length(s-q)-(.56-.05*f),.5);}',
    '  c=c*.62;',
    '  c+=.03*sin(4.*p.x+t*2.)*sin(4.*p.y+t*1.5)*sin(4.*p.z+t);',
    '  c=smin(c,length(p-MP)-.26*MF+(1.-MF)*10.,.5);',
    '  return c;',
    '}',
    'float map(vec3 p){',
    '  float d=smin(canopy(p),cap(p,vec3(0.,-.3,0.),vec3(.06,1.35,0.),.19),.35);',
    '  for(int i=0;i<7;i++)d=smin(d,root(p,float(i)),.16);',
    '  return d+(1.-G)*2.2;',
    '}',
    'vec3 nrm(vec3 p){vec2 e=vec2(.0018,0.);return normalize(vec3(map(p+e.xyy)-map(p-e.xyy),map(p+e.yxy)-map(p-e.yxy),map(p+e.yyx)-map(p-e.yyx)));}',
    /* glowing filaments that continue each root down to the library */
    'float glowAt(vec3 p){',
    '  float yg=WL+.2-L*7.;float g=0.;',
    '  for(int i=0;i<7;i++){float fi=float(i);',
    '    float ang=fi*.8976+.35*sin(fi*2.3);float h=.28+.3*fract(fi*.618);float d=1.7+.4*fract(fi*.377+.2);float r=d-.12;',
    '    vec2 dir=vec2(cos(ang),sin(ang));',
    '    vec3 base=vec3(dir.x*d,h-r,dir.y*d);',
    '    vec3 tip=base+vec3(dir.x*.3,-3.2,dir.y*.3);',
    '    vec3 b1=tip+vec3(dir.x*.9+.5*dir.y,-2.2,dir.y*.9-.5*dir.x);',
    '    vec3 b2=tip+vec3(dir.x*.2-.7*dir.y,-2.6,dir.y*.2+.7*dir.x);',
    '    float dd=min(cap(p,base,tip,0.),min(cap(p,tip,b1,0.),cap(p,tip,b2,0.)));',
    '    float on=smoothstep(yg-.5,yg,p.y);',
    '    g+=(exp(-dd*50.)+.6*exp(-length(p-b1)*9.)+.6*exp(-length(p-b2)*9.))*on;',
    '  }',
    '  return g;',
    '}',
    'vec3 envA(vec3 r){',
    '  float y=r.y,a=atan(r.x,r.z);',
    '  vec3 c=mix(vec3(.004),vec3(.045,.05,.055),smoothstep(-.1,.9,y));',
    '  c+=vec3(.45,.55,.55)*exp(-abs(y-.03)*26.);',
    '  c+=vec3(.03,.08,.08)*smoothstep(0.,-.6,y);',
    '  c+=vec3(4.)*smoothstep(.07,.0,abs(a-1.05))*smoothstep(-.15,.15,y)*smoothstep(.95,.55,y);',
    '  c+=vec3(2.2,2.5,2.5)*smoothstep(.045,.0,abs(a+1.85))*smoothstep(-.25,.05,y)*smoothstep(.9,.45,y);',
    '  c+=vec3(3.)*smoothstep(.05,.0,abs(r.x+.2))*smoothstep(.72,.92,y);',
    '  return c;',
    '}',
    'vec3 skyA(vec3 rd){return vec3(.003,.005,.006)+vec3(.02,.1,.09)*exp(-abs(rd.y)*9.)*.5;}',
    'vec3 fogC(vec3 rd){return mix(vec3(.0,.01,.014),vec3(.02,.15,.14),smoothstep(-.6,1.,rd.y));}',
    'vec3 envU(vec3 r){return fogC(r)*2.6+vec3(.5,1.,.9)*smoothstep(.75,.98,r.y)*.7;}',
    'vec3 shade(vec3 p,vec3 rd,bool under){',
    '  vec3 n=nrm(p);vec3 v=-rd;vec3 rf=reflect(rd,n);',
    '  float fr=pow(1.-max(dot(n,v),0.),3.);',
    '  vec3 e=under?envU(rf):envA(rf);',
    '  vec3 ir=.5+.5*cos(6.2831*(fr*1.3+vec3(0.,.33,.67))+T*.15);',
    '  vec3 col=e*vec3(.84,.9,.9)+e*fr*.4+ir*fr*.08;',
    '  float ao=clamp(map(p+n*.3)/.3,0.,1.);',
    '  return col*(.5+.5*ao);',
    '}',
    'void main(){',
    '  vec2 u0=(gl_FragCoord.xy-.5*R)/R.y;',
    '  vec3 ww=normalize(TGT-CAM);vec3 uu=normalize(cross(ww,vec3(0.,1.,0.)));vec3 vv=cross(uu,ww);',
    '  vec3 rd=normalize(u0.x*uu+u0.y*vv+1.7*ww);',
    '  vec3 rdm=normalize(M.x*uu+M.y*vv+1.7*ww);',
    '  MP=CAM+rdm*(length(CAM-vec3(0.,1.8,0.))-.4);',
    '  vec3 col;',
    '  if(CAM.y>WL){',
    '    float tw=rd.y<-.0001?(WL-CAM.y)/rd.y:1e4;',
    '    float t=0.;bool hit=false;vec3 p=CAM;',
    '    for(int i=0;i<100;i++){p=CAM+rd*t;float d=map(p);if(d<.0015){hit=true;break;}t+=d*.9;if(t>tw||t>30.)break;}',
    '    if(hit&&t<tw){col=shade(p,rd,false);}',
    '    else if(tw<30.){',
    '      vec3 wp=CAM+rd*tw;vec2 q=wp.xz;float tt=T*.6;',
    '      vec3 n=normalize(vec3(.025*cos(q.x*2.1+tt)+.018*cos(q.y*3.3-tt*1.3)+.01*cos((q.x+q.y)*5.+tt*2.),1.,.025*sin(q.y*2.4+tt*.9)+.015*sin(q.x*3.7+tt*1.4)));',
    '      vec3 rr=reflect(rd,n);',
    '      float fr=.04+.96*pow(1.-max(dot(n,-rd),0.),5.);',
    '      vec3 rc=skyA(rr);float t2=.03;bool h2=false;vec3 p2=wp;',
    '      for(int i=0;i<64;i++){p2=wp+rr*t2;float d=map(p2);if(d<.003){h2=true;break;}t2+=d*.95;if(t2>20.)break;}',
    '      if(h2)rc=shade(p2,rr,false)*.8;',
    '      col=mix(vec3(.0,.012,.016),rc,.25+.75*fr);',
    '      col+=vec3(.3,1.,.85)*step(.996,hash(floor(q*42.)+floor(T*2.)))*exp(-length(q)*.3)*.9;',
    '      col*=exp(-tw*.035);',
    '    } else {col=skyA(rd);}',
    '  } else {',
    '    float t=0.,g=0.;bool hit=false;vec3 p=CAM;',
    '    for(int i=0;i<90;i++){p=CAM+rd*t;float d=map(p);g+=glowAt(p)*.02;if(d<.002){hit=true;break;}t+=clamp(d*.9,.02,.6);if(t>22.)break;}',
    '    vec3 bg=fogC(rd);',
    '    if(rd.y>0.){float tw=(WL-CAM.y)/rd.y;vec2 q=(CAM+rd*tw).xz;float c=pow(.5+.5*sin(q.x*3.+T)*sin(q.y*3.4-T*.8),6.);',
    '      bg+=vec3(.4,.9,.85)*(.15+.6*c)*exp(-tw*.25)*smoothstep(0.,.3,rd.y);}',
    '    col=hit?mix(shade(p,rd,true),bg,1.-exp(-t*.12)):bg;',
    '    col+=vec3(.2,1.,.82)*g*(.35+.65*L);',
    '    col+=vec3(.08,.3,.28)*pow(max(rd.y,0.),3.)*.25;',
    '  }',
    '  col*=D;',
    '  col*=1.-.36*dot(u0*.85,u0*.85);',
    '  col=col/(1.+col*.75);',
    '  col=pow(col,vec3(.4545));',
    '  col+=(hash(gl_FragCoord.xy+fract(T*.37)*311.)-.5)*.035;',
    '  gl_FragColor=vec4(col,1.);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('Mangrove shader:', gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  var vs = compile(gl.VERTEX_SHADER, VS), fs = compile(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) { document.documentElement.classList.add('no-gl'); return; }
  var prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error('Mangrove link:', gl.getProgramInfoLog(prog)); document.documentElement.classList.add('no-gl'); return; }
  gl.useProgram(prog);
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var U = {};
  ['R', 'T', 'CAM', 'TGT', 'M', 'MF', 'L', 'G', 'D'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

  /* camera path, keyed on page progress c: [c, camera height, look-at height] */
  var KEYS = [[0, 1.2, 1.0], [0.3, 0.45, 0.35], [0.56, -0.82, -1.0], [0.7, -1.45, -2.0], [1, -3.2, -4.6]];
  function camAt(c) {
    for (var i = 0; i < KEYS.length - 1; i++) {
      var a = KEYS[i], b = KEYS[i + 1];
      if (c <= b[0]) {
        var f = (c - a[0]) / (b[0] - a[0]); f = f * f * (3 - 2 * f);
        return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      }
    }
    return [KEYS[KEYS.length - 1][1], KEYS[KEYS.length - 1][2]];
  }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  var target = { c: 0, d: 1, mfx: 0 }, cur = { c: reduce ? 0.56 : 0, d: 1, mf: 0, mx: 0, my: 0 };
  var mouse = [0, 0], moved = false;
  /* page progress c is pinned to the sections, so the camera reaches the water at the waterline,
     sinks with the tide and lights the roots as the library comes up, whatever each section's height */
  var ANCHORS = [['top', 0], ['canopee', 0.3], ['ligne-d-eau', 0.5], ['maree', 0.6], ['racines', 0.74], ['bibliotheque', 1]];
  function measure() {
    var h = window.innerHeight, y = window.scrollY, pts = [];
    ANCHORS.forEach(function (a) {
      var el = document.getElementById(a[0]);
      if (el) pts.push([a[0] === 'top' ? 0 : el.getBoundingClientRect().top + y - h * 0.2, a[1]]);
    });
    if (pts.length < 2) return;
    var c = pts[pts.length - 1][1];
    for (var i = 0; i < pts.length - 1; i++) {
      if (y <= pts[i + 1][0]) { c = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * clamp((y - pts[i][0]) / Math.max(1, pts[i + 1][0] - pts[i][0]), 0, 1); break; }
    }
    target.c = reduce ? 0.56 : c;
    var lib = document.getElementById('bibliotheque');
    var libTop = lib ? lib.getBoundingClientRect().top + y : 1e9;
    target.d = 1 - 0.32 * clamp((y - libTop + h * 0.6) / h, 0, 1);
  }
  window.addEventListener('scroll', measure, { passive: true });
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  window.addEventListener('pointermove', function (e) {
    var h = window.innerHeight;
    mouse = [(e.clientX - window.innerWidth / 2) / h, -(e.clientY - h / 2) / h];
    moved = true;
  }, { passive: true });

  var scale = 1;
  function size() {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5), w = window.innerWidth, h = window.innerHeight;
    var cap = Math.min(1, Math.sqrt(9e5 / (w * h * dpr * dpr)));
    var s = cap * scale;
    cv.width = Math.max(2, Math.round(w * dpr * s));
    cv.height = Math.max(2, Math.round(h * dpr * s));
    gl.viewport(0, 0, cv.width, cv.height);
  }
  size();
  window.addEventListener('resize', size);
  measure();

  var t0 = performance.now(), last = t0, slow = 0, frames = 0;
  function frame(now) {
    var dt = now - last; last = now;
    /* adaptive resolution: drop render scale if the GPU struggles */
    if (frames++ > 20) { slow = slow * 0.9 + (dt > 30 ? 1 : 0) * 0.1; if (slow > 0.6 && scale > 0.5) { scale *= 0.82; size(); slow = 0; } }
    var el = (now - t0) / 1000;
    var grow = reduce ? 1 : 1 - Math.pow(1 - Math.min(1, el / 2.2), 4);
    var k = reduce ? 1 : 0.06;
    cur.c += (target.c - cur.c) * k;
    cur.d += (target.d - cur.d) * k;
    var mfT = moved && cur.c < 0.3 ? 1 : 0;
    cur.mf += (mfT - cur.mf) * 0.05;
    cur.mx += (mouse[0] - cur.mx) * (reduce ? 1 : 0.08);
    cur.my += (mouse[1] - cur.my) * (reduce ? 1 : 0.08);
    var ch = camAt(cur.c);
    var aspect = window.innerWidth / window.innerHeight;
    var Z = (aspect < 1 ? 7.4 + 4.2 * (1 - aspect) : 6.6) * (1 - 0.12 * cur.c);
    var ang = -0.25 + cur.c * 0.9 + (reduce ? 0 : cur.mx * 0.12);
    gl.uniform2f(U.R, cv.width, cv.height);
    gl.uniform1f(U.T, reduce ? 6 : el + 6);
    gl.uniform3f(U.CAM, Math.sin(ang) * Z, ch[0], Math.cos(ang) * Z);
    gl.uniform3f(U.TGT, 0, ch[1], 0);
    gl.uniform2f(U.M, cur.mx, cur.my);
    gl.uniform1f(U.MF, reduce ? 0 : cur.mf);
    gl.uniform1f(U.L, clamp((cur.c - 0.62) / 0.38, 0, 1));
    gl.uniform1f(U.G, grow);
    gl.uniform1f(U.D, cur.d);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);
})();
