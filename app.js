// あまた堂 再生ツール：購入したzipを端末の中だけで展開し、シートと進行アプリを開く
"use strict";
pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

const $ = (s) => document.querySelector(s);
let game = null;          // { title, common, chars:[{no,name,file}], cards, app, readme }
let appUrl = null;        // 進行アプリの Blob URL
let viewerFrom = "menu";  // PDFを閉じたときに戻る画面

// ---- 画面の切り替え ----
function show(id) {
  document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id));
  window.scrollTo(0, 0);
}
document.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => show(b.dataset.go)));

// ---- 保存（使えない環境でも動く） ----
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const charKey = () => "amatado:char:" + game.title;

// ---- 確認ダイアログ ----
function ask(text, yes = "開く") {
  return new Promise((resolve) => {
    const d = $("#confirm");
    $("#confirmText").textContent = text;
    $("#confirmYes").textContent = yes;
    $("#confirmYes").onclick = () => { d.close(); resolve(true); };
    $("#confirmNo").onclick = () => { d.close(); resolve(false); };
    d.showModal();
  });
}

// ---- zipを読む ----
$("#zipInput").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  $("#homeMsg").textContent = "開いています…";
  try {
    game = await readZip(f);
    $("#homeMsg").textContent = "";
    openMenu();
  } catch (err) {
    console.error(err);
    $("#homeMsg").textContent = err.message || "zipを開けませんでした。";
  }
});

async function readZip(file) {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((x) => !x.dir && !x.name.split("/").pop().startsWith("."));
  const base = (x) => x.name.split("/").pop();
  const g = { title: "", common: null, chars: [], cards: null, app: null, readme: null };
  for (const x of entries) {
    const n = base(x);
    if (/\.pdf$/i.test(n)) {
      if (n.includes("共通シート")) g.common = x;
      else if (n.includes("調査カード")) g.cards = x;
      else {
        const m = n.match(/_PC(\d+)_(.+)\.pdf$/i);
        if (m) g.chars.push({ no: +m[1], name: m[2], file: x });
      }
    } else if (/\.html?$/i.test(n)) g.app = x;
    else if (n.includes("はじめに") && /\.txt$/i.test(n)) g.readme = x;
  }
  g.chars.sort((a, b) => a.no - b.no);
  if (!g.common && !g.chars.length && !g.app) throw new Error("このzipには、あまた堂の作品のファイルが見つかりませんでした。");
  // 題名：zipの中のフォルダ名、なければファイル名
  const dir = entries.find((x) => x.name.includes("/"));
  g.title = dir ? dir.name.split("/")[0] : file.name.replace(/(_v[\d.]+)?\.zip$/i, "");
  return g;
}

// ---- 一覧 ----
function openMenu() {
  $("#gameTitle").textContent = game.title;
  $("#openCommon").disabled = !game.common;
  $("#openChars").disabled = !game.chars.length;
  $("#openApp").disabled = !game.app;
  $("#openCards").disabled = !game.cards;
  $("#openReadme").disabled = !game.readme;
  const mine = myChar();
  $("#resetChar").hidden = !mine;
  $("#charNote").textContent = mine ? `あなた：${mine.name}（PC${mine.no}）` : `${game.chars.length}人。自分のキャラクターを選んでから開きます`;
  show("menu");
}
function myChar() {
  const v = store.get(charKey());
  return game.chars.find((c) => String(c.no) === v) || null;
}

$("#openCommon").onclick = () => viewPdf(game.common, "共通シート", "menu");
$("#openCards").onclick = async () => {
  if (await ask("これは紙に印刷して遊ぶとき用のPDFで、調査カードの中身がすべて載っています。
スマホで遊ぶときは、進行アプリの「調査」でカードを開いてください。
印刷用に開きますか？")) viewPdf(game.cards, "調査カード", "menu");
};
$("#openReadme").onclick = async () => {
  $("#textBody").textContent = await game.readme.async("string");
  show("text");
};

// ---- キャラクターシート ----
$("#openChars").onclick = async () => {
  const mine = myChar();
  if (mine) { viewPdf(mine.file, mine.name, "menu"); return; }
  renderCharList();
  show("chars");
};
function renderCharList() {
  const box = $("#charList");
  box.innerHTML = "";
  for (const c of game.chars) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "charbtn";
    b.innerHTML = `<small>PC${c.no}</small>`;
    b.append(document.createTextNode(c.name));
    b.onclick = async () => {
      if (!(await ask(`あなたは「${c.name}」ですか？\nこの端末では、次からこのシートだけが開きます。`))) return;
      store.set(charKey(), String(c.no));
      viewPdf(c.file, c.name, "menu");
    };
    box.append(b);
  }
}
// 選び直し
$("#resetChar").onclick = async () => {
  if (await ask("この端末で選んだキャラクターを取り消して、選び直しますか？", "取り消す")) {
    store.del(charKey());
    openMenu();
  }
};

// ---- PDFを見る（PDF.jsでページを描く） ----
let viewToken = 0;
async function viewPdf(entry, title, from) {
  const token = ++viewToken;
  viewerFrom = from;
  $("#viewerTitle").textContent = title;
  const box = $("#pages");
  box.innerHTML = '<p class="loading">読み込んでいます…</p>';
  show("viewer");
  const data = await entry.async("uint8array");
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  if (token !== viewToken) return;
  box.innerHTML = "";
  const width = Math.min(box.clientWidth || window.innerWidth, 900);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    if (token !== viewToken) return;
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: (width * dpr) / v1.width });
    const c = document.createElement("canvas");
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    c.setAttribute("aria-label", `${title} ${i}ページ目`);
    box.append(c);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  }
}
$("#viewerBack").onclick = () => { viewToken++; $("#pages").innerHTML = ""; show(viewerFrom); };

// ---- 進行アプリ ----
$("#openApp").onclick = async () => {
  if (!appUrl) {
    const html = await game.app.async("string");
    appUrl = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  }
  $("#appFrame").src = appUrl;
  show("player");
};
$("#playerBack").onclick = async () => {
  if (await ask("一覧に戻りますか？ 進み具合は保存されていて、また開くと続きから始まります。", "戻る")) {
    $("#appFrame").src = "about:blank";
    openMenu();
  }
};
// zipを選び直したら古いアプリを片づける
$("#zipInput").addEventListener("click", () => { if (appUrl) { URL.revokeObjectURL(appUrl); appUrl = null; } });
