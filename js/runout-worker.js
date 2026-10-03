/* ---------- runout maths off the main thread ----------
   Release areas and the three runout bands take a few hundred milliseconds
   per tile on a laptop and several times that on a phone, which would freeze
   panning. runout.js hands the work to this worker and gets typed arrays
   back. It loads runout-core.js, the same file the page and the harness use,
   so all three run the same code. */
importScripts('runout-core.js');

onmessage = e=>{
  const m = e.data;
  try {
    const out = runoutJob(m.type, m);
    postMessage({id:m.id, out:out}, [out.buffer]);
  } catch(err){
    postMessage({id:m.id, error:String(err && err.message || err)});
  }
};
