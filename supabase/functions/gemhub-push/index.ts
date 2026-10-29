import webpush from "npm:web-push@3.6.7";
import {createClient} from "npm:@supabase/supabase-js@2.57.0";
const cors={"Access-Control-Allow-Origin":"https://sizerock00-debug.github.io","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info,x-supabase-api-version","Access-Control-Allow-Methods":"POST,OPTIONS"};
Deno.serve(async(req)=>{if(req.method==="OPTIONS")return new Response("",{headers:cors});const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});try{
const jwt=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");if(!jwt)return response({error:"로그인 필요"},401);
const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const vapidPublic=Deno.env.get("GEMHUB_VAPID_PUBLIC_KEY"),vapidPrivate=Deno.env.get("GEMHUB_VAPID_PRIVATE_KEY");if(!vapidPublic||!vapidPrivate)return response({error:"VAPID keys not configured"},503);
webpush.setVapidDetails("https://sizerock00-debug.github.io/gemhub/",vapidPublic,vapidPrivate);
const client=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+jwt}}});const {data:{user},error:userError}=await client.auth.getUser();if(userError||!user)return response({error:"인증 실패"},401);
const admin=createClient(url,service);const {message_id}=await req.json();if(!Number.isSafeInteger(message_id))return response({error:"메시지 ID 오류"},400);
const {data:msg,error:msgError}=await admin.from("trade_messages").select("id,post_id,sender_id,recipient_id,body,read_at").eq("id",message_id).single();if(msgError||!msg||msg.sender_id!==user.id)return response({error:"접근 불가"},403);
const {data:post}=await admin.from("trade_posts").select("title,status").eq("id",msg.post_id).maybeSingle();if(post?.status==="completed")return response({ok:true,skipped:"completed"});
if(msg.read_at)return response({ok:true,skipped:"already_read"});
const {data:subs,error:subError}=await admin.from("gemhub_push_subscriptions").select("id,endpoint,p256dh,auth_key").eq("user_id",msg.recipient_id);if(subError)throw subError;
if(!subs?.length)return response({ok:true,attempted:0,failed:0,skipped:"no_subscription"});
const {error:claimError}=await admin.from("gemhub_push_deliveries").insert({message_id:msg.id});if(claimError){if(claimError.code==="23505")return response({ok:true,duplicate:true});throw claimError}
const payload=JSON.stringify({title:"💬 겜허브 · 새 거래 메시지",body:(post?.title||"거래글")+" · "+(msg.body||"새 메시지").slice(0,110),postId:msg.post_id,senderId:msg.sender_id,tag:"gemhub-chat-"+msg.post_id});
const results=await Promise.allSettled((subs||[]).map(async s=>{try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth_key}},payload,{TTL:86400,urgency:"high"})}catch(e){if(e?.statusCode===404||e?.statusCode===410)await admin.from("gemhub_push_subscriptions").delete().eq("id",s.id);else throw e}}));return response({ok:true,attempted:results.length,failed:results.filter(r=>r.status==="rejected").length})
}catch(e){console.error("gemhub push error",e);return response({error:"푸시 발송 실패"},500)}});
