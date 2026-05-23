try{var l=localStorage.getItem('app_language')||'en';document.documentElement.lang=l;var t=localStorage.getItem('app-theme')||'amethyst';var c={modern:'theme-modern',notion:'theme-notion',spotify:'theme-spotify',amethyst:'theme-amethyst'};if(c[t])document.documentElement.classList.add(c[t])}catch(e){}
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
