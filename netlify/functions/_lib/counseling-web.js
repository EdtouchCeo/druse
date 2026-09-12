'use strict';
// Small JSON/HTML adapter for our handlers; Netlify's native Request entry keeps
// platform credentials in the runtime, never in request headers or JSON bodies.
function fromHandler(handler){return async request=>{
 const url=new URL(request.url),headers=Object.fromEntries(request.headers);
 const queryStringParameters=Object.fromEntries(url.searchParams);
 const body=['GET','HEAD'].includes(request.method)?'':await request.text();
 const result=await handler({httpMethod:request.method,headers,body,isBase64Encoded:false,path:url.pathname,queryStringParameters});
 return new Response(result.body||null,{status:result.statusCode,headers:result.headers||{}});
};}
module.exports={fromHandler};
