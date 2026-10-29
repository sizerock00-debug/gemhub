import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const cors = {
  "Access-Control-Allow-Origin": "https://sizerock00-debug.github.io",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  const response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    if (req.method !== "POST") return response({ ok: false, error: "POST 요청만 허용됩니다." }, 405);
    const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!jwt) return response({ ok: false, error: "로그인이 필요합니다." }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublic = Deno.env.get("GEMHUB_VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("GEMHUB_VAPID_PRIVATE_KEY");
    if (!url || !anon || !service || !vapidPublic || !vapidPrivate) {
      return response({ ok: false, error: "푸시 서버 설정이 완료되지 않았습니다." }, 503);
    }

    webpush.setVapidDetails("https://sizerock00-debug.github.io/gemhub/", vapidPublic, vapidPrivate);
    const userClient = createClient(url, anon, { global: { headers: { Authorization: "Bearer " + jwt } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return response({ ok: false, error: "로그인 인증에 실패했습니다." }, 401);

    const admin = createClient(url, service);
    const { data: subs, error: subError } = await admin
      .from("gemhub_push_subscriptions")
      .select("id,endpoint,p256dh,auth_key")
      .eq("user_id", user.id);
    if (subError) throw subError;
    if (!subs?.length) return response({
      ok: true, attempted: 0, delivered: 0, failed: 0,
      error: "등록된 푸시 기기가 없습니다. 먼저 대화 도착 알림을 켜 주세요.",
    });

    const payload = JSON.stringify({
      title: "🔔 겜허브 · 푸시 시험 알림",
      body: "푸시 알림이 이 기기에 도착했습니다. 거래 대화 알림을 받을 준비가 되었습니다.",
      test: true,
      tag: "gemhub-push-test",
      url: "https://sizerock00-debug.github.io/gemhub/",
    });

    const results = await Promise.allSettled(subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload,
          { TTL: 300, urgency: "high" },
        );
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await admin.from("gemhub_push_subscriptions").delete().eq("id", sub.id);
        }
        throw err;
      }
    }));
    const delivered = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - delivered;
    return response({ ok: true, attempted: subs.length, delivered, failed });
  } catch (err) {
    console.error("gemhub push test error", err);
    return response({ ok: false, error: "푸시 시험 발송 중 오류가 발생했습니다." }, 500);
  }
});
