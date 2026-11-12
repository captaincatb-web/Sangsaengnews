"use strict";
const {chromium}=require("playwright");
const http=require("http"),fs=require("fs"),path=require("path");
const site=path.resolve(__dirname,"../site"),out=path.resolve(__dirname,"../preview-screenshots");
fs.mkdirSync(out,{recursive:true});
const mime={".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",".json":"application/json",".css":"text/css",".woff2":"font/woff2",".svg":"image/svg+xml",".png":"image/png"};
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,"http://local").pathname);
 const fn=path.resolve(site,"."+name);
 if(!fn.startsWith(site+path.sep)||!fs.existsSync(fn)||fs.statSync(fn).isDirectory()){res.writeHead(404);res.end();return}
 res.writeHead(200,{"content-type":mime[path.extname(fn)]||"application/octet-stream"});fs.createReadStream(fn).pipe(res);
});
(async()=>{
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const base="http://127.0.0.1:"+server.address().port;
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  for(const size of [390,1280]){
   const context=await browser.newContext({viewport:{width:size,height:950},deviceScaleFactor:1,colorScheme:"light"});
   const page=await context.newPage();
   await page.goto(base+"/pair-compare.html",{waitUntil:"domcontentloaded"});
   await page.locator("#pc-tbl tbody tr").first().waitFor({timeout:20000});
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0)});
   await page.screenshot({path:path.join(out,"pair-top-"+size+".png"),fullPage:false,animations:"disabled"});
   await page.locator("#detail-card").scrollIntoViewIfNeeded();
   await page.evaluate(()=>window.scrollBy(0,-60));
   await page.screenshot({path:path.join(out,"pair-table-"+size+".png"),fullPage:false,animations:"disabled"});
   console.log("screenshots",size);
   await context.close();
  }
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});