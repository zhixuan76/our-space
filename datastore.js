// 小家数据中转站 · our-space datastore
// 小家的数据从 Gist 搬进了私人仓库 zhixuan76/our-space-data（2026.10.19 · 第144天）。
// 这个脚本接住页面里原本发往 Gist 的读写请求，改成读写私人仓库里的 our-space-data.json。
// 页面其他代码完全不用动；token 依旧存在 localStorage 'our-space-token'，
// 但现在要填的是只能访问 our-space-data 的 fine-grained token（github_pat_...）。
(function () {
  const OLD_GIST_ID = 'c5c9d7ccb16247de5d5eb515e4df44ff';
  const FILE = 'our-space-data.json';
  const REPO_API = 'https://api.github.com/repos/zhixuan76/our-space-data';
  const realFetch = window.fetch.bind(window);

  function authFrom(init) {
    const h = (init && init.headers) || {};
    if (h instanceof Headers) return h.get('Authorization');
    return h.Authorization || h.authorization || null;
  }

  function apiHeaders(auth, accept) {
    return { 'Authorization': auth, 'Accept': accept || 'application/vnd.github+json' };
  }

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async function readData(auth) {
    const res = await realFetch(`${REPO_API}/contents/${FILE}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: apiHeaders(auth, 'application/vnd.github.raw+json')
    });
    // 旧的 Gist token 读私人仓库会得到 404/403：统一当成 401，让页面清掉旧 token、请你填新的
    if (res.status === 401 || res.status === 403 || res.status === 404) return jsonResponse({ message: 'need new token' }, 401);
    if (!res.ok) return res;
    const content = await res.text();
    // 伪装成 Gist 的回传格式：页面只读 files[FILE].content
    return jsonResponse({ id: OLD_GIST_ID, files: { [FILE]: { filename: FILE, content } } });
  }

  async function currentSha(auth) {
    const res = await realFetch(`${REPO_API}/contents/${FILE}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: apiHeaders(auth)
    });
    if (res.status === 404) return undefined; // 文件还不存在：第一次写入不需要 sha
    if (!res.ok) throw new Error('sha lookup failed: ' + res.status);
    return (await res.json()).sha;
  }

  async function writeData(auth, body) {
    const payload = typeof body === 'string' ? JSON.parse(body) : body;
    const content = payload && payload.files && payload.files[FILE] && payload.files[FILE].content;
    if (typeof content !== 'string') return jsonResponse({ message: 'nothing to save' }, 400);
    const stamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur', hour12: false });
    // 两次机会：遇到 409（别人刚好也在写）就拿最新 sha 再试一次
    for (let attempt = 0; attempt < 2; attempt++) {
      const sha = await currentSha(auth);
      const res = await realFetch(`${REPO_API}/contents/${FILE}`, {
        method: 'PUT',
        headers: Object.assign(apiHeaders(auth), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ message: `🏠 小家更新 · ${stamp}`, content: utf8ToBase64(content), sha })
      });
      if (res.status !== 409 && res.status !== 422) return res;
    }
    return jsonResponse({ message: 'conflict' }, 409);
  }

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf(`api.github.com/gists/${OLD_GIST_ID}`) === -1) return realFetch(input, init);
    const auth = authFrom(init);
    const method = ((init && init.method) || 'GET').toUpperCase();
    if (method === 'GET') return readData(auth);
    if (method === 'PATCH') return writeData(auth, init.body);
    return realFetch(input, init);
  };
})();
