
// ============================================================================
// Edge Function: submit-post
// ---------------------------------------------------------------------------
// تستقبل مشاركة الزائر (نص + صورة اختيارية) عبر multipart/form-data وتنفذ كل
// التحققات من جهة الخادم قبل الحفظ:
//   1. فحص أن الحقول ضمن الحدود (نوع المشاركة، طول النص، طول الاسم).
//   2. فحص النوع الحقيقي للصورة من محتوى الملف (magic bytes) وليس الامتداد.
//   3. حد أقصى 5 ميجابايت + صيغ JPG/PNG/WebP فقط.
//   4. إعادة تسمية الصورة باسم عشوائي (UUID) يولّده الخادم.
//   5. منع الإرسال المتكرر: 3 إرسالات لكل 10 دقائق لكل مصدر (IP مجزّأ بـ sha256+salt)
//      و5 مشاركات كحد أقصى في الساعة من نفس المصدر.
//   6. فخ honeypot + زمن تعبئة النموذج (مضاد للروبوتات).
//   7. تنظيف النصوص (إزالة علامات التحكم + قص المسافات) — العرض في الموقع يتم
//      عبر textContent فقط فلا يمكن تنفيذ أي HTML/JS من محتوى المشاركة.
//   8. حفظ المشاركة بحالة 'pending' — لا تظهر للزوار قبل موافقة المدير.
// ---------------------------------------------------------------------------
// المتغيرات البيئية (تُضبط بـ supabase secrets set أو من لوحة التحكم):
//   IP_SALT       : سلسلة عشوائية طويلة لتجزئة IP (إلزامي).
//   RATE_WINDOW_S : نافذة الحد الأساسي بالثواني (اختياري، الافتراضي 600).
//   RATE_MAX      : الحد الأقصى داخل النافذة (اختياري، الافتراضي 3).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.1';

const MAX_FILE = 5 * 1024 * 1024; // 5MB
const MAX_NAME = 40;
const MAX_BODY = 1000;
const HOURLY_MAX = 5;
const MIN_ELAPSED_MS = 1500;
const KINDS = new Set(['dua', 'kind', 'memory', 'photo', 'photo_words']);
const NEEDS_BODY = new Set(['dua', 'kind', 'memory', 'photo_words']);
const NEEDS_IMAGE = new Set(['photo', 'photo_words']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function sniffImage(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return { mime: 'image/webp', ext: 'webp' };
  return null;
}

function cleanText(s) {
  // إزالة أحرف التحكم والفواصل الخطيرة + تطبيع المسافات + حروف اتجاه غير ضرورية
  return String(s || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function checkRate(admin, ipHash) {
  const windowS = Number.parseInt(Deno.env.get('RATE_WINDOW_S') || '600', 10);
  const maxN = Number.parseInt(Deno.env.get('RATE_MAX') || '3', 10);
  const { data, error } = await admin.rpc('check_memorial_post_rate_limit', {
    p_ip_hash: ipHash,
    p_window_s: Number.isFinite(windowS) ? windowS : 600,
    p_max: Number.isFinite(maxN) ? maxN : 3,
    p_hourly_max: HOURLY_MAX,
  });
  if (error) {
    console.error('rate check failed', error);
    throw new Error('rate check failed');
  }
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, message: 'طريقة الطلب غير مسموحة.' }, 405);

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const form = await req.formData();

    // ---- فخ الروبوتات: honeypot ----
    if (String(form.get('website') || '') !== '') return json({ ok: true, trap: true });

    // ---- زمن التعبئة (مضاد للإرسال الآلي) ----
    const elapsed = parseInt(String(form.get('elapsed') || '0'), 10);
    if (!Number.isFinite(elapsed) || elapsed < MIN_ELAPSED_MS) {
      return json({ ok: false, message: 'إرسال سريع جدًا؛ يرجى كتابة المشاركة بتأنٍ.' }, 429);
    }

    // ---- الحقول ----
    const name = cleanText(form.get('name')).slice(0, MAX_NAME);
    const kind = String(form.get('kind') || '');
    const body = cleanText(form.get('body')).slice(0, MAX_BODY);
    if (!KINDS.has(kind)) return json({ ok: false, message: 'نوع المشاركة غير صالح.' }, 400);
    if (NEEDS_BODY.has(kind) && !body) return json({ ok: false, message: 'نص المشاركة مطلوب لهذا النوع.' }, 400);
    if (body.length > MAX_BODY) return json({ ok: false, message: 'النص أطول من الحد المسموح.' }, 400);

    // ---- الصورة: فحص النوع الحقيقي (magic bytes) وليس الامتداد ----
    let imageMeta = null;
    let imageBytes = null;
    const file = form.get('image');
    if (file && typeof file === 'object' && 'arrayBuffer' in file && file.size > 0) {
      if (file.size > MAX_FILE) return json({ ok: false, message: 'حجم الصورة يتجاوز 5 ميجابايت.' }, 413);
      imageBytes = new Uint8Array(await file.arrayBuffer());
      const sniff = sniffImage(imageBytes);
      if (!sniff) {
        return json({ ok: false, message: 'الملف ليس صورة صالحة. الصيغ المسموحة: JPG أو PNG أو WebP.' }, 415);
      }
      imageMeta = sniff;
    }
    if (NEEDS_IMAGE.has(kind) && !imageMeta) {
      return json({ ok: false, message: 'هذا النوع يتطلب إرفاق صورة.' }, 400);
    }

    // ---- الحد من الإرسال المتكرر (IP مجزّأ بـ salt، لا يُخزَّن IP خام) ----
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-real-ip') ||
      'unknown';

    // IP_SALT إلزامي: لا نستخدم قيمة افتراضية غير آمنة
    const salt = Deno.env.get('IP_SALT');
    if (!salt) {
      console.error('IP_SALT secret is missing');
      return json({ ok: false, message: 'إعدادات الخادم غير مكتملة.' }, 500);
    }

    const ipHash = await sha256Hex(ip + '|' + salt);

    const allowed = await checkRate(admin, ipHash);
    if (!allowed) {
      return json({ ok: false, message: 'لقد أرسلت عدة مشاركات مؤخرًا؛ يرجى المحاولة بعد قليل.' }, 429);
    }

    // ---- رفع الصورة باسم عشوائي يولّده الخادم ----
    let imagePath = null;
    if (imageMeta && imageBytes) {
      imagePath = 'posts/' + crypto.randomUUID() + '.' + imageMeta.ext;
      const up = await admin.storage
        .from('memorial-images')
        .upload(imagePath, imageBytes, { contentType: imageMeta.mime, cacheControl: '31536000', upsert: false });
      if (up.error) {
        console.error('storage upload failed', up.error);
        return json({ ok: false, message: 'تعذر حفظ الصورة على الخادم؛ لم يتم إرسال المشاركة.' }, 500);
      }
    }

    // ---- الحفظ بحالة «قيد المراجعة» ----
    const ins = await admin.from('memorial_posts').insert({
      name: name || null,
      kind,
      body,
      image_path: imagePath,
      status: 'pending',
      ip_hash: ipHash,
    });
    if (ins.error) {
      if (imagePath) await admin.storage.from('memorial-images').remove([imagePath]);
      console.error('insert failed', ins.error);
      return json({ ok: false, message: 'تعذر حفظ المشاركة؛ حاول لاحقًا.' }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    console.error('submit-post error', e);
    return json({ ok: false, message: 'حدث خطأ غير متوقع في الخادم.' }, 500);
  }
});
