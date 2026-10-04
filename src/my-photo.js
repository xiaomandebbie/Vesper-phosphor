// 你发动态时配的那张图。
//
// TA 那边是服务端直接生成文件（见 actions/moment.js），你这边是在手机浏览器里选图，
// 走的不是同一条路：得先传上来。跟头像那套一样的做法（见 moments-store.js 的 saveProfileAvatar）：
//   浏览器里先缩小压成 JPEG，以 base64 跟表单一起提交；
//   服务端只认真正的 JPEG/PNG/WebP 文件头，不信 data URL 里写的类型。
//
// 为什么要在浏览器里先压：手机随手一张图就是几 MB，直接传上行会卡很久，
// 而且 express 的 body 上限是 1mb（见 vesper.js），原图根本进不来。
// 缩到长边 1600、质量 0.82，手机屏上看不出差别，体积一般在 200〜400KB。

import fs from 'fs';
import path from 'path';
import { sniffImage } from './moments-store.js';

const MEDIA_DIR = process.env.MEDIA_DIR || '/opt/vesper/media';
const IMAGE_DIR = path.join(MEDIA_DIR, 'images');
// 浏览器已经压过了，这里再兜一道。比头像宽很多：动态配图该看得清
const MAX_IMAGE_BYTES = 900 * 1024;

// dataUrl 是浏览器压好的 data:image/jpeg;base64,...。成功返回 { url }，失败返回 { error }
export function saveUserMomentImage(dataUrl) {
  const raw = String(dataUrl ?? '').trim();
  if (!raw) return { url: null };
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);
  if (!m) return { error: '图片格式不对，换一张试试' };

  const buf = Buffer.from(m[1], 'base64');
  if (!buf.length) return { error: '图片是空的，换一张试试' };
  if (buf.length > MAX_IMAGE_BYTES) return { error: '图片太大了，换一张小一点的' };

  const ext = sniffImage(buf);
  if (!ext) return { error: '图片格式不对，换一张试试' };

  try {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
    // 文件名带 mine- 前缀，一眼能认出是你传的，不是 TA 生成的
    const filename = `mine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    fs.writeFileSync(path.join(IMAGE_DIR, filename), buf);
    return { url: `/media/images/${filename}` };
  } catch (err) {
    console.error('my-photo: 写入图片失败', err.message);
    return { error: '图片没存下来，看一下 vesper 的日志' };
  }
}

// ── 选图的那个入口 ──────────────────────────────────────────────────────
// 插在「写点什么」表单里。没有 JavaScript 时整个隐起来：压缩靠 canvas，没 JS 就没法压，
// 而直接传原图一定超过 1mb 上限。文字还是能正常发。

export const PHOTO_FIELD_HTML = `<div class="mine-photo js-only">
  <label class="mine-photo-btn" for="mine-photo-file">
    <span aria-hidden="true">⊕</span> 配一张图
  </label>
  <input type="file" id="mine-photo-file" accept="image/*" hidden />
  <input type="hidden" name="image_data" id="mine-photo-data" />
  <div class="mine-photo-preview" id="mine-photo-preview" hidden>
    <img id="mine-photo-img" alt="" />
    <button type="button" class="mine-photo-drop" id="mine-photo-drop" aria-label="不要这张图">×</button>
  </div>
  <p class="mine-photo-note" id="mine-photo-note" hidden></p>
</div>`;

export const PHOTO_CSS = `
  .mine-photo { margin-top: 8px; }
  html:not(.js) .js-only { display: none; }
  .mine-photo-btn { display: inline-flex; align-items: center; gap: 5px; min-height: 36px; padding: 0 12px;
    background: var(--card-soft, #f3eef2); border: 1px solid var(--line); border-radius: 10px;
    color: var(--accent); font-size: 13px; cursor: pointer; }
  .mine-photo-btn:active { transform: scale(.98); }
  .mine-photo-preview { position: relative; display: inline-block; margin-top: 8px; }
  .mine-photo-preview img { display: block; max-width: 160px; max-height: 160px;
    border-radius: 10px; border: 1px solid var(--line); }
  .mine-photo-drop { position: absolute; top: -8px; right: -8px; width: 26px; height: 26px;
    display: flex; align-items: center; justify-content: center;
    background: var(--card); color: var(--muted); border: 1px solid var(--line);
    border-radius: 50%; font-size: 15px; line-height: 1; cursor: pointer;
    box-shadow: 0 1px 4px rgba(60, 30, 60, .18); }
  .mine-photo-note { margin: 6px 0 0; font-size: 12px; color: var(--muted); }
  .mine-photo-note.bad { color: var(--accent); }
`;

// 选完图就在浏览器里缩好压好，存进那个 hidden 字段，跳图片跟表单一起提交。
// 超大图（比如单反拍的）压完还是太大时，逐步降质量重试，最多三次。
export const PHOTO_SCRIPT = `(function () {
  var file = document.getElementById('mine-photo-file');
  var data = document.getElementById('mine-photo-data');
  var box = document.getElementById('mine-photo-preview');
  var img = document.getElementById('mine-photo-img');
  var drop = document.getElementById('mine-photo-drop');
  var note = document.getElementById('mine-photo-note');
  if (!file || !data || !box || !img || !drop) return;

  var MAX_EDGE = 1600;
  var LIMIT = 900 * 1024;

  function say(msg, bad) {
    if (!note) return;
    note.textContent = msg || '';
    note.hidden = !msg;
    note.className = 'mine-photo-note' + (bad ? ' bad' : '');
  }

  function clear() {
    file.value = '';
    data.value = '';
    img.removeAttribute('src');
    box.hidden = true;
    say('');
  }

  drop.addEventListener('click', clear);

  // canvas 重画一遍。透明 PNG 会被压成黑底，所以先铺一层白
  function shrink(bitmapOrImg, w, h, quality) {
    var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    var c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(bitmapOrImg, 0, 0, cw, ch);
    return c.toDataURL('image/jpeg', quality);
  }

  function accept(src, w, h) {
    var q = 0.82;
    var out = shrink(src, w, h, q);
    // base64 比原始字节大约 4/3，估一下真实体积
    for (var i = 0; i < 3 && out.length * 0.75 > LIMIT; i++) {
      q -= 0.18;
      out = shrink(src, w, h, Math.max(0.3, q));
    }
    if (out.length * 0.75 > LIMIT) {
      say('这张图太大了，换一张试试', true);
      clear();
      return;
    }
    data.value = out;
    img.src = out;
    box.hidden = false;
    say('图已准备好，发出去时一起带上');
  }

  file.addEventListener('change', function () {
    var f = file.files && file.files[0];
    if (!f) return clear();
    if (!/^image\\//.test(f.type)) {
      say('这不是图片文件', true);
      return clear();
    }
    say('正在处理…');

    // createImageBitmap 是快路（不走主线程解码）；不支持就退回 Image + objectURL
    if (window.createImageBitmap) {
      createImageBitmap(f).then(function (bmp) {
        accept(bmp, bmp.width, bmp.height);
        if (bmp.close) bmp.close();
      }).catch(function () {
        say('这张图读不出来，换一张试试', true);
        clear();
      });
      return;
    }

    var url = URL.createObjectURL(f);
    var el = new Image();
    el.onload = function () {
      accept(el, el.naturalWidth, el.naturalHeight);
      URL.revokeObjectURL(url);
    };
    el.onerror = function () {
      say('这张图读不出来，换一张试试', true);
      URL.revokeObjectURL(url);
      clear();
    };
    el.src = url;
  });
})();`;
