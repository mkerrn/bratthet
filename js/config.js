/* Friends mode. The plain link is the public site; opening it once with
   ?friends turns on the layers we may only use among ourselves (the Strava
   heatmap, Esri aerial photos) and is remembered on that device. ?friends=0
   switches the device back. This is not a lock (the code is public), it only
   keeps the link that gets shared around clean. */
const FRIENDS = (()=>{
  const q = new URLSearchParams(location.search).get('friends');
  try{
    if(q !== null) localStorage.setItem('bratthet.friends', q === '0' ? '0' : '1');
    return localStorage.getItem('bratthet.friends') === '1';
  }catch(e){ return q !== null && q !== '0'; }
})();

/* The heatmap always uses this tile URL; the Activity menu swaps the sport in
   it. Leave it empty and the Heatmap section and its layer row disappear. */
const HEATMAP_URL = FRIENDS ? 'https://heatmap-external-a.strava.com/tiles/winter/hot/{z}/{x}/{y}.png' : '';
